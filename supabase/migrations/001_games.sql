-- Glomere Games — migration 001
-- Run in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
-- (Or: supabase db push, if the Supabase CLI is linked to the project.)
-- Tables mirror the API contract in js/api.js. Rooms are PIN-gated by
-- obscurity, same model as the Muse artifact: the anon role can read/write
-- these tables, and the 4-letter PIN is the only gate. There is no per-user
-- auth in v1; secrets (words, trio/roast authors) are hidden by the UI's
-- per-player view, not by the database — see README "Supabase mode limits".

create extension if not exists pgcrypto;

-- Rooms ---------------------------------------------------------------------
create table if not exists public.rooms (
  id text primary key,
  code text not null unique,            -- 4-letter PIN, e.g. 'TQWQ'
  game text not null check (game in ('party', 'twl', 'undercover', 'roast')),
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'reveal', 'finished')),
  judge_mode boolean not null default false,
  host_player_id text,
  current_round integer not null default 0,
  state jsonb not null default '{}'::jsonb,  -- per-game phase data (see js/api.js freshState)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rooms_code_idx on public.rooms (code);
create index if not exists rooms_updated_idx on public.rooms (updated_at desc);

-- Players -------------------------------------------------------------------
create table if not exists public.players (
  id text primary key,
  room_id text not null references public.rooms (id) on delete cascade,
  nickname text not null,
  is_host boolean not null default false,
  is_bot boolean not null default false,
  lang text not null default 'zh',
  score integer not null default 0,
  word text,                            -- secret word (undercover); null for blank / non-players
  is_undercover boolean not null default false,
  has_blank boolean not null default false,
  join_order integer not null default 0,
  alive boolean not null default true,
  is_judge boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists players_room_idx on public.players (room_id);
create index if not exists players_room_join_idx on public.players (room_id, join_order);

-- Submissions (answers / clues / statements / roasts / votes / judge input) --
create table if not exists public.submissions (
  id text primary key,
  room_id text not null references public.rooms (id) on delete cascade,
  player_id text not null,
  round_no integer not null default 0,
  kind text not null check (kind in ('answer', 'clue', 'statement', 'roast', 'vote', 'judge_question')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists submissions_room_idx on public.submissions (room_id);
create index if not exists submissions_room_round_idx on public.submissions (room_id, round_no);
create index if not exists submissions_player_idx on public.submissions (room_id, player_id);

-- Row Level Security: anon role can read/write all three tables.
-- (PIN-gated by obscurity — v1 model, same as the artifact.)
alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "anon all" on public.rooms;
create policy "anon all" on public.rooms
  for all to anon using (true) with check (true);

drop policy if exists "anon all" on public.players;
create policy "anon all" on public.players
  for all to anon using (true) with check (true);

drop policy if exists "anon all" on public.submissions;
create policy "anon all" on public.submissions
  for all to anon using (true) with check (true);

-- Optional housekeeping: delete rooms (and their players/submissions, via
-- cascade) older than 24h. Run as a scheduled query or pg_cron job.
-- delete from public.rooms where created_at < now() - interval '24 hours';
