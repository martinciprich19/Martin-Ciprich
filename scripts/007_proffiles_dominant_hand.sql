alter table public.proffiles
  add column if not exists dominant_hand text not null default 'right';

alter table public.proffiles
  drop constraint if exists proffiles_dominant_hand_check;

alter table public.proffiles
  add constraint proffiles_dominant_hand_check
  check (dominant_hand in ('right', 'left', 'both'));
