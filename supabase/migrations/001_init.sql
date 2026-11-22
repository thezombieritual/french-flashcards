-- French flashcards: one person's review state.
-- Run this once in the Supabase SQL editor (free project).
-- The anon key is public. These policies are what keep the rows private.

create table if not exists public.card_states (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id text not null,
  ease double precision not null,
  interval_days integer not null,
  repetitions integer not null,
  due timestamptz not null,
  lapses integer not null default 0,
  last_review timestamptz,
  state text not null check (state in ('new', 'learning', 'review')),
  learning_step integer not null default 0,
  introduced_on date,
  updated_at timestamptz not null,
  primary key (user_id, card_id)
);

create table if not exists public.review_logs (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id text not null,
  grade text not null check (grade in ('again', 'hard', 'good', 'easy')),
  reviewed_at timestamptz not null,
  primary key (user_id, card_id, reviewed_at)
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  new_per_day integer not null default 10 check (new_per_day between 0 and 100),
  autoplay boolean not null default false,
  disabled_deck_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.card_states enable row level security;
alter table public.review_logs enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists card_states_own on public.card_states;
create policy card_states_own on public.card_states
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists review_logs_own on public.review_logs;
create policy review_logs_own on public.review_logs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_settings_own on public.user_settings;
create policy user_settings_own on public.user_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.card_states from anon;
revoke all on public.review_logs from anon;
revoke all on public.user_settings from anon;

grant select, insert, update, delete on public.card_states to authenticated;
grant select, insert, update, delete on public.review_logs to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;
