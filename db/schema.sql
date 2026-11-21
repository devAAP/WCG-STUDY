-- ═══════════════════════════════════════════════════════════════════════════
-- Testament Quest: database schema (PostgreSQL 15+, Supabase-compatible)
--
-- Design rules:
--   • Streak, tier and unlock rules run inside `log_reading()` (SECURITY DEFINER).
--     Clients cannot write profile counters, progress or artifacts directly.
--   • The reading day comes from the server clock in the reader's own time zone,
--     so a day can't be backdated by changing the device clock.
--   • These rules mirror quest/js/engine.js. Both must change together;
--     tests/engine.test.mjs and db/test.sql cover each side.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Reference data ─────────────────────────────────────────────────────────

create table milestones (
  id              smallint primary key,
  code            text unique not null,
  name            text not null,
  threshold_days  int  not null unique check (threshold_days > 0),
  sanctuary_stage smallint not null,
  description     text not null
);

insert into milestones values
  (1, 'foundation', 'Foundation',  7, 1, 'Stone foundation laid'),
  (2, 'growth',     'Growth',     30, 2, 'Walls, garden and courtyard'),
  (3, 'mastery',    'Mastery',    90, 3, 'Completed sanctuary with lampstand');

create table books (
  num         smallint primary key check (num between 1 and 66),
  name        text not null unique,
  chapters    smallint not null check (chapters > 0),
  testament   text not null check (testament in ('Hebrew Scriptures','Christian Greek Scriptures')),
  section     text not null,
  quest_order smallint not null unique
);

create table bosses (
  section   text primary key,
  name      text not null,
  icon      text not null
);

create table artifacts (
  id        serial primary key,
  book_num  smallint not null unique references books(num),
  icon      text not null,
  name      text not null,
  lore      text not null
);

-- ── People ─────────────────────────────────────────────────────────────────

create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text not null check (char_length(display_name) between 1 and 40),
  time_zone         text not null default 'UTC',
  current_streak    int  not null default 0 check (current_streak >= 0),
  longest_streak    int  not null default 0 check (longest_streak >= 0),
  total_days_read   int  not null default 0 check (total_days_read >= 0),
  streak_shields    smallint not null default 0 check (streak_shields between 0 and 2),
  last_read_day     date,
  tier_id           smallint references milestones(id),          -- assigned tier
  -- Automated encouragement (opt-in; the recipient's consent, not the sender's)
  encourage_opt_in  boolean not null default false,
  telegram_chat_id  text,
  whatsapp_e164     text check (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  created_at        timestamptz not null default now()
);

create table friendships (
  user_id    uuid not null references profiles(id) on delete cascade,
  friend_id  uuid not null references profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

-- ── Reading and progress ───────────────────────────────────────────────────

create table reading_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references profiles(id) on delete cascade,
  book_num     smallint not null references books(num),
  chapter      smallint not null,
  read_day     date not null,
  quiz_correct smallint not null,
  quiz_total   smallint not null check (quiz_total > 0),
  created_at   timestamptz not null default now(),
  unique (user_id, book_num, chapter, read_day)
);
create index reading_logs_user_day on reading_logs (user_id, read_day desc);

create table chapter_progress (
  user_id      uuid not null references profiles(id) on delete cascade,
  book_num     smallint not null references books(num),
  chapter      smallint not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, book_num, chapter)
);

create table user_artifacts (
  user_id     uuid not null references profiles(id) on delete cascade,
  artifact_id int  not null references artifacts(id),
  earned_at   timestamptz not null default now(),
  primary key (user_id, artifact_id)
);

create table boss_victories (
  user_id     uuid not null references profiles(id) on delete cascade,
  section     text not null references bosses(section),
  score       smallint not null,
  defeated_at timestamptz not null default now(),
  primary key (user_id, section)
);

-- ── Congregation mode ──────────────────────────────────────────────────────

create table congregations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 60),
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  goal_laps   smallint not null default 1 check (goal_laps between 1 and 10),
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now()
);

create table congregation_members (
  congregation_id uuid not null references congregations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  role            text not null default 'member' check (role in ('member','overseer')),
  joined_at       timestamptz not null default now(),
  primary key (congregation_id, user_id)
);

-- ── Encouragement outbox ───────────────────────────────────────────────────

create table encouragements (
  id                  bigint generated always as identity primary key,
  from_user           uuid references profiles(id) on delete set null,   -- null = system nudge
  to_user             uuid not null references profiles(id) on delete cascade,
  channel             text not null check (channel in ('telegram','whatsapp','push','share')),
  message             text not null,
  status              text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  provider_message_id text,
  error               text,
  send_day            date not null default current_date,
  created_at          timestamptz not null default now()
);
-- At most one message per sender → recipient per day per channel (anti-spam).
create unique index encouragements_daily
  on encouragements (coalesce(from_user, '00000000-0000-0000-0000-000000000000'::uuid), to_user, channel, send_day);

-- ═══════════════════════════════════════════════════════════════════════════
-- Game logic
-- ═══════════════════════════════════════════════════════════════════════════

-- Is `p_book` open for this user? (First book on the path, or the previous
-- book is complete and, if it closed a section, that section's boss is beaten.)
create or replace function book_unlocked(p_user uuid, p_book smallint)
returns boolean language sql stable as $$
  with target as (select quest_order from books where num = p_book),
  prev as (
    select b.* from books b, target t where b.quest_order = t.quest_order - 1
  ),
  prev_done as (
    select (select count(*) from chapter_progress cp
             where cp.user_id = p_user and cp.book_num = prev.num) >= prev.chapters as complete,
           prev.section,
           not exists (select 1 from books b2
                        where b2.section = prev.section and b2.quest_order > prev.quest_order) as finale
    from prev
  )
  select case
    when (select quest_order from target) = 1 then true
    when not exists (select 1 from prev_done) then false
    else (select complete and (not finale or exists (
            select 1 from boss_victories bv where bv.user_id = p_user and bv.section = prev_done.section))
          from prev_done)
  end
$$;

-- Log a passed reading. Returns a JSON summary for the client to animate.
create or replace function log_reading(p_book smallint, p_chapter smallint,
                                       p_correct smallint, p_total smallint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_prof   profiles%rowtype;
  v_book   books%rowtype;
  v_today  date;
  v_gap    int;
  v_event  text;
  v_new_ch boolean := false;
  v_done   int;
  v_art    artifacts%rowtype;
  v_tier   smallint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_book from books where num = p_book;
  if not found or p_chapter < 1 or p_chapter > v_book.chapters then
    raise exception 'invalid chapter';
  end if;
  if p_total < 1 or p_correct < 0 or p_correct > p_total then raise exception 'invalid quiz score'; end if;
  if p_correct * 3 < p_total * 2 then raise exception 'quiz not passed'; end if;   -- ≥ 2/3
  if not book_unlocked(v_user, p_book) then raise exception '% is locked', v_book.name; end if;

  select * into v_prof from profiles where id = v_user for update;
  v_today := (now() at time zone v_prof.time_zone)::date;

  insert into reading_logs (user_id, book_num, chapter, read_day, quiz_correct, quiz_total)
  values (v_user, p_book, p_chapter, v_today, p_correct, p_total)
  on conflict do nothing;

  insert into chapter_progress (user_id, book_num, chapter) values (v_user, p_book, p_chapter)
  on conflict do nothing;
  v_new_ch := found;

  -- Streak (same rules as engine.applyReadingDay)
  if v_prof.last_read_day = v_today then
    v_event := 'same-day';
  else
    v_gap := v_today - v_prof.last_read_day;
    if v_prof.last_read_day is null then
      v_prof.current_streak := 1; v_event := 'started';
    elsif v_gap = 1 then
      v_prof.current_streak := v_prof.current_streak + 1; v_event := 'extended';
    elsif v_gap = 2 and v_prof.streak_shields > 0 then
      v_prof.streak_shields := v_prof.streak_shields - 1;
      v_prof.current_streak := v_prof.current_streak + 1; v_event := 'shield-used';
    else
      v_prof.current_streak := 1; v_event := 'reset';
    end if;
    v_prof.total_days_read := v_prof.total_days_read + 1;
    v_prof.last_read_day   := v_today;
    v_prof.longest_streak  := greatest(v_prof.longest_streak, v_prof.current_streak);
    if v_prof.current_streak % 7 = 0 and v_prof.streak_shields < 2 then
      v_prof.streak_shields := v_prof.streak_shields + 1;
    end if;
  end if;

  -- Tier from longest streak (never demotes)
  select id into v_tier from milestones
   where threshold_days <= v_prof.longest_streak order by threshold_days desc limit 1;

  update profiles set current_streak = v_prof.current_streak, longest_streak = v_prof.longest_streak,
         total_days_read = v_prof.total_days_read, streak_shields = v_prof.streak_shields,
         last_read_day = v_prof.last_read_day, tier_id = v_tier
   where id = v_user;

  -- Book completion → artifact
  select count(*) into v_done from chapter_progress where user_id = v_user and book_num = p_book;
  if v_new_ch and v_done = v_book.chapters then
    select * into v_art from artifacts where book_num = p_book;
    if found then
      insert into user_artifacts (user_id, artifact_id) values (v_user, v_art.id) on conflict do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'event', v_event, 'read_day', v_today,
    'current_streak', v_prof.current_streak, 'longest_streak', v_prof.longest_streak,
    'total_days_read', v_prof.total_days_read, 'shields', v_prof.streak_shields,
    'tier', (select code from milestones where id = v_tier),
    'new_chapter', v_new_ch,
    'book_completed', v_new_ch and v_done = v_book.chapters,
    'artifact', case when v_art.id is null then null else to_jsonb(v_art) end,
    'boss', case when v_new_ch and v_done = v_book.chapters
                  and not exists (select 1 from books b where b.section = v_book.section and b.quest_order > v_book.quest_order)
                 then v_book.section end
  );
end $$;

create or replace function record_boss_victory(p_section text, p_correct smallint, p_total smallint)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_last books%rowtype;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_correct * 4 < p_total * 3 then return false; end if;                 -- bosses need ≥ 3/4
  select * into v_last from books where section = p_section order by quest_order desc limit 1;
  if not found then raise exception 'unknown section'; end if;
  if (select count(*) from chapter_progress where user_id = v_user and book_num = v_last.num) < v_last.chapters then
    raise exception 'finish % first', v_last.name;
  end if;
  insert into boss_victories (user_id, section, score) values (v_user, p_section, p_correct)
  on conflict do nothing;
  return true;
end $$;

-- The creator of a congregation becomes its first overseer.
create or replace function add_congregation_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into congregation_members (congregation_id, user_id, role) values (new.id, new.created_by, 'overseer');
  return new;
end $$;
create trigger congregations_creator after insert on congregations
  for each row execute function add_congregation_creator();

create or replace function join_congregation(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from congregations where invite_code = upper(trim(p_code));
  if v_id is null then raise exception 'invalid invite code'; end if;
  insert into congregation_members (congregation_id, user_id) values (v_id, auth.uid())
  on conflict do nothing;
  return v_id;
end $$;

-- ── Read models ────────────────────────────────────────────────────────────

-- Pooled chapters for the shared monument: every passed reading by a member
-- since joining (re-reads count; this is about reading together, not uniqueness).
create or replace view congregation_monument as
select c.id as congregation_id, c.name, c.goal_laps,
       count(rl.id)                                as pooled_chapters,
       c.goal_laps * (select sum(chapters) from books) as goal_chapters,
       count(distinct cm.user_id)                  as members
from congregations c
join congregation_members cm on cm.congregation_id = c.id
left join reading_logs rl on rl.user_id = cm.user_id and rl.created_at >= cm.joined_at
group by c.id;

-- Fellowship leaderboard: ranked by days read in the last 7 days, then streak.
create or replace view fellowship_leaderboard as
select cm.congregation_id, p.id as user_id, p.display_name,
       case when (now() at time zone p.time_zone)::date - p.last_read_day <= 1
              or ((now() at time zone p.time_zone)::date - p.last_read_day = 2 and p.streak_shields > 0)
            then p.current_streak else 0 end as live_streak,
       p.total_days_read, m.code as tier,
       (select count(distinct rl.read_day) from reading_logs rl
         where rl.user_id = p.id
           and rl.read_day > (now() at time zone p.time_zone)::date - 7) as week_days
from congregation_members cm
join profiles p on p.id = cm.user_id
left join milestones m on m.id = p.tier_id;

-- Who to nudge: opted-in users who haven't read today and whose streak is savable.
create or replace view encouragement_candidates as
select p.id, p.display_name, p.current_streak, p.telegram_chat_id, p.whatsapp_e164,
       (now() at time zone p.time_zone)::date as local_today,
       extract(hour from now() at time zone p.time_zone)::int as local_hour
from profiles p
where p.encourage_opt_in
  and p.last_read_day is not null
  and (now() at time zone p.time_zone)::date - p.last_read_day between 1 and 2
  and ((now() at time zone p.time_zone)::date - p.last_read_day = 1 or p.streak_shields > 0);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ═══════════════════════════════════════════════════════════════════════════

alter table profiles             enable row level security;
alter table friendships          enable row level security;
alter table reading_logs         enable row level security;
alter table chapter_progress     enable row level security;
alter table user_artifacts       enable row level security;
alter table boss_victories       enable row level security;
alter table congregations        enable row level security;
alter table congregation_members enable row level security;
alter table encouragements       enable row level security;

-- Helper: do two users share a congregation or an accepted friendship?
create or replace function in_fellowship(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a = b
      or exists (select 1 from congregation_members x join congregation_members y
                   on x.congregation_id = y.congregation_id where x.user_id = a and y.user_id = b)
      or exists (select 1 from friendships f where f.status = 'accepted'
                   and ((f.user_id = a and f.friend_id = b) or (f.user_id = b and f.friend_id = a)))
$$;

-- Reference data: readable by everyone, writable by no client.
alter table milestones enable row level security;
alter table books      enable row level security;
alter table bosses     enable row level security;
alter table artifacts  enable row level security;
create policy milestones_read on milestones for select using (true);
create policy books_read      on books      for select using (true);
create policy bosses_read     on bosses     for select using (true);
create policy artifacts_read  on artifacts  for select using (true);

create policy profiles_read on profiles for select using (in_fellowship(auth.uid(), id));
create policy profiles_insert on profiles for insert with check (id = auth.uid());
-- Users may edit only their own non-game columns; counters are written by log_reading().
create policy profiles_update on profiles for update using (id = auth.uid());

create policy own_logs      on reading_logs     for select using (in_fellowship(auth.uid(), user_id));
create policy own_progress  on chapter_progress for select using (user_id = auth.uid());
create policy own_artifacts on user_artifacts   for select using (in_fellowship(auth.uid(), user_id));
create policy own_bosses    on boss_victories   for select using (user_id = auth.uid());

create policy friends_read   on friendships for select using (auth.uid() in (user_id, friend_id));
create policy friends_ask    on friendships for insert with check (user_id = auth.uid() and status = 'pending');
create policy friends_accept on friendships for update using (friend_id = auth.uid()) with check (status = 'accepted');
create policy friends_remove on friendships for delete using (auth.uid() in (user_id, friend_id));

create or replace function is_member(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from congregation_members where congregation_id = c and user_id = auth.uid())
$$;

create policy cong_read    on congregations for select using (is_member(id));
create policy cong_create  on congregations for insert with check (created_by = auth.uid());
create policy members_read on congregation_members for select using (is_member(congregation_id));
create policy members_leave on congregation_members for delete using (user_id = auth.uid());

create policy encourage_read on encouragements for select using (auth.uid() in (from_user, to_user));
create policy encourage_send on encouragements for insert with check (
  from_user = auth.uid() and channel = 'share' and in_fellowship(from_user, to_user));

-- Views run with the caller's rights so RLS above still filters them.
alter view congregation_monument  set (security_invoker = on);
alter view fellowship_leaderboard set (security_invoker = on);
-- ── Privileges ─────────────────────────────────────────────────────────────
-- Supabase grants ALL on public tables to `anon` and `authenticated` directly,
-- so revoking from PUBLIC alone is not enough. RLS limits rows; these grants
-- limit columns and operations. Game state is written only by the
-- SECURITY DEFINER functions above.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'public'] loop
    if r = 'public' or exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke insert, update, delete, truncate on milestones, books, bosses, artifacts,
                      reading_logs, chapter_progress, user_artifacts, boss_victories from %s', r);
      execute format('revoke update on profiles from %s', r);
      execute format('revoke update on congregations from %s', r);
      execute format('revoke update on encouragements from %s', r);
      execute format('revoke all on encouragement_candidates from %s', r);   -- service role only
      execute format('grant update (display_name, time_zone, encourage_opt_in, telegram_chat_id, whatsapp_e164)
                      on profiles to %s', r);
    end if;
  end loop;
end $$;
