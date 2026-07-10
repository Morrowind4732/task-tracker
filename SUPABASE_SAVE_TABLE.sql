-- Fancy Card Table - Game Save State table
-- Run this in the Supabase SQL editor.

create table if not exists public.fct_game_saves (
  lobby_name text primary key,
  mode text not null default 'magic',
  save_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fct_game_saves_updated_at_idx
  on public.fct_game_saves (updated_at desc);

-- For the current anon-key browser prototype, allow public read/write.
-- Tighten this later when you add real auth.
alter table public.fct_game_saves enable row level security;

drop policy if exists "fct saves public read" on public.fct_game_saves;
create policy "fct saves public read"
  on public.fct_game_saves
  for select
  using (true);

drop policy if exists "fct saves public insert" on public.fct_game_saves;
create policy "fct saves public insert"
  on public.fct_game_saves
  for insert
  with check (true);

drop policy if exists "fct saves public update" on public.fct_game_saves;
create policy "fct saves public update"
  on public.fct_game_saves
  for update
  using (true)
  with check (true);
