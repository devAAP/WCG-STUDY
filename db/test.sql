-- Integration test for log_reading / unlocks / bosses / monument.
-- Run: psql -v ON_ERROR_STOP=1 -f db/supabase-shim.sql -f db/schema.sql -f db/seed.sql -f db/test.sql
\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into profiles (id, display_name, time_zone) values
  ('11111111-1111-1111-1111-111111111111', 'Ama', 'Africa/Accra'),
  ('22222222-2222-2222-2222-222222222222', 'Kofi', 'America/New_York');
set test.uid = '11111111-1111-1111-1111-111111111111';

do $$
declare r jsonb; i int; ok boolean;
begin
  -- Locked book rejected
  begin perform log_reading(40::smallint, 1::smallint, 3::smallint, 3::smallint);
        raise exception 'expected Matthew to be locked';
  exception when others then if sqlerrm not like '%locked%' then raise; end if; end;

  -- Failing quiz rejected
  begin perform log_reading(43::smallint, 1::smallint, 1::smallint, 3::smallint);
        raise exception 'expected failing quiz to be rejected';
  exception when others then if sqlerrm not like '%not passed%' then raise; end if; end;

  r := log_reading(43::smallint, 1::smallint, 3::smallint, 3::smallint);
  assert r->>'event' = 'started', r::text;
  assert (r->>'current_streak')::int = 1;
  r := log_reading(43::smallint, 2::smallint, 2::smallint, 3::smallint);
  assert r->>'event' = 'same-day' and (r->>'total_days_read')::int = 1, r::text;

  -- Simulate 7 consecutive days by rewinding last_read_day
  for i in 2..7 loop
    update profiles set last_read_day = last_read_day - 1 where id = auth.uid();
    perform log_reading(43::smallint, (i + 1)::smallint, 3::smallint, 3::smallint);
  end loop;
  select current_streak, tier_id, streak_shields into i, i, i from profiles where id = auth.uid();
  assert (select tier_id from profiles where id = auth.uid()) = 1, 'foundation tier';
  assert (select streak_shields from profiles where id = auth.uid()) = 1, 'shield earned';

  -- Finish John → artifact + Matthew unlocked
  for i in 9..21 loop perform log_reading(43::smallint, i::smallint, 3::smallint, 3::smallint); end loop;
  assert exists (select 1 from user_artifacts ua join artifacts a on a.id = ua.artifact_id
                  where ua.user_id = auth.uid() and a.book_num = 43), 'John artifact';
  assert book_unlocked(auth.uid(), 40::smallint), 'Matthew unlocked';

  -- Matthew, Mark, Luke → Gospels boss gates Acts
  insert into chapter_progress (user_id, book_num, chapter)
    select auth.uid(), b.num, g from books b, generate_series(1, b.chapters) g where b.num in (40, 41, 42);
  assert not book_unlocked(auth.uid(), 44::smallint), 'Acts gated by boss';
  ok := record_boss_victory('Gospels', 2::smallint, 4::smallint);
  assert not ok, 'boss needs 3/4';
  ok := record_boss_victory('Gospels', 4::smallint, 4::smallint);
  assert ok and book_unlocked(auth.uid(), 44::smallint), 'Acts unlocked after boss';
end $$;

-- Congregation: creator auto-joins; second member joins by code; monument pools.
insert into congregations (name, created_by) values ('Accra Central', '11111111-1111-1111-1111-111111111111');
set test.uid = '22222222-2222-2222-2222-222222222222';
select join_congregation((select invite_code from congregations limit 1));
select log_reading(43::smallint, 1::smallint, 3::smallint, 3::smallint);

do $$ begin
  assert (select members from congregation_monument) = 2, 'two members';
  assert (select pooled_chapters from congregation_monument) >= 1, 'pooled reading';
  assert (select goal_chapters from congregation_monument) = 1189, 'goal';
  assert (select count(*) from fellowship_leaderboard) = 2, 'leaderboard rows';
end $$;

-- Daily anti-spam limit on encouragements
insert into encouragements (from_user, to_user, channel, message)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'share', 'Keep going!');
do $$ begin
  insert into encouragements (from_user, to_user, channel, message)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'share', 'Again!');
  raise exception 'expected daily limit';
exception when unique_violation then null; end $$;

-- RLS: run as an unprivileged role (superusers bypass RLS).
insert into auth.users values ('33333333-3333-3333-3333-333333333333');
insert into profiles (id, display_name) values ('33333333-3333-3333-3333-333333333333', 'Stranger');
set role authenticated;   -- Supabase's role for signed-in users
set test.uid = '33333333-3333-3333-3333-333333333333';
do $$ begin
  assert (select count(*) from profiles) = 1, 'stranger sees only self';
  assert (select count(*) from reading_logs) = 0, 'stranger sees no logs';
  assert (select count(*) from congregation_members) = 0, 'stranger sees no members';
  begin
    update profiles set current_streak = 999 where id = auth.uid();
    raise exception 'expected counter update to be denied';
  exception when insufficient_privilege then null; end;
  begin
    insert into chapter_progress (user_id, book_num, chapter) values (auth.uid(), 43, 1);
    raise exception 'expected direct progress insert to be denied';
  exception when insufficient_privilege then null; end;
  begin
    update books set chapters = 1 where num = 43;
    raise exception 'expected reference-data update to be denied';
  exception when insufficient_privilege then null; end;
  begin
    perform * from encouragement_candidates;
    raise exception 'expected candidates view to be service-only';
  exception when insufficient_privilege then null; end;
  update profiles set display_name = 'Stranger B' where id = auth.uid();   -- allowed column
  assert (select display_name from profiles where id = auth.uid()) = 'Stranger B';
  assert (select count(*) from books) = 66, 'reference data readable';
  assert (log_reading(43::smallint, 1::smallint, 3::smallint, 3::smallint))->>'event' = 'started', 'RPC works for authenticated';
  assert (select current_streak from profiles where id = auth.uid()) = 1;
end $$;
set test.uid = '11111111-1111-1111-1111-111111111111';
do $$ begin
  assert (select count(*) from profiles) = 2, 'Ama sees self + congregation member';
  assert (select count(*) from congregation_members) = 2, 'Ama sees her congregation';
end $$;
reset role;

\echo 'ALL DB TESTS PASSED'
