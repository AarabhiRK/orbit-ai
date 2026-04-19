-- HOW TO RUN: Open Supabase Dashboard → SQL → New query → paste this file → Run.
-- Do not run from the terminal (not Python, not npm, not `cd schema.sql`).
-- Then enable Email auth under Authentication → Providers.
--
-- If the editor warns about "destructive operations": that is from
-- `drop trigger if exists` below. It does NOT drop tables or user data.
-- It only removes the auth signup hook so we can re-attach it to this function.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  last_visit_ymd text,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  goals_data jsonb not null default '[]'::jsonb,
  calendar_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_visits (
  user_id uuid not null references auth.users (id) on delete cascade,
  visit_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, visit_date)
);

alter table public.profiles enable row level security;
alter table public.daily_visits enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "visits_select_own" on public.daily_visits;
drop policy if exists "visits_insert_own" on public.daily_visits;
create policy "visits_select_own" on public.daily_visits for select using (auth.uid() = user_id);
create policy "visits_insert_own" on public.daily_visits for insert with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
