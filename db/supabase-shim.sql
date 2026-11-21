-- Minimal stand-in for Supabase's auth schema so schema.sql runs on plain
-- Postgres (local tests / CI). Do NOT apply this on Supabase itself.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

-- Reproduce Supabase's default privileges so tests catch grant mistakes:
-- anon/authenticated get ALL on public tables (created after this point).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
