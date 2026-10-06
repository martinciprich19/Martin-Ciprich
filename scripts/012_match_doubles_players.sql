alter table public.matches
  add column if not exists team1_player2_id bigint references public.proffiles(id) on delete set null,
  add column if not exists team2_player2_id bigint references public.proffiles(id) on delete set null;