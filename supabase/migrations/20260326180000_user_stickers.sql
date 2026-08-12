-- User sticker collection (references stickers, no file duplication)

create table if not exists public.user_stickers (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sticker_id uuid not null references public.stickers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sticker_id)
);

create index if not exists user_stickers_sticker_idx
  on public.user_stickers (sticker_id);

alter table public.user_stickers enable row level security;

create policy "Users view own sticker collection"
  on public.user_stickers for select to authenticated
  using (user_id = auth.uid());

create policy "Users save stickers to collection"
  on public.user_stickers for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users remove stickers from collection"
  on public.user_stickers for delete to authenticated
  using (user_id = auth.uid());

-- Existing uploads belong in the owner's collection
insert into public.user_stickers (user_id, sticker_id, created_at)
select owner_id, id, created_at from public.stickers
on conflict do nothing;

-- When a sticker is created, auto-add to creator's collection
create or replace function public.stickers_auto_collect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_stickers (user_id, sticker_id)
  values (new.owner_id, new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists stickers_auto_collect_trg on public.stickers;
create trigger stickers_auto_collect_trg
  after insert on public.stickers
  for each row execute function public.stickers_auto_collect();

-- Save someone else's sticker into my collection (no file copy)
create or replace function public.save_sticker(p_sticker_id uuid)
returns public.stickers
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.stickers;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into s from public.stickers where id = p_sticker_id;
  if s.id is null then
    raise exception 'Sticker not found';
  end if;

  insert into public.user_stickers (user_id, sticker_id)
  values (auth.uid(), p_sticker_id)
  on conflict do nothing;

  return s;
end;
$$;

grant execute on function public.save_sticker(uuid) to authenticated;

-- Remove from my collection only (does not delete the asset unless I own it and delete stickers row)
create or replace function public.unsave_sticker(p_sticker_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  delete from public.user_stickers
  where user_id = auth.uid() and sticker_id = p_sticker_id;
end;
$$;

grant execute on function public.unsave_sticker(uuid) to authenticated;

grant select, insert, delete on public.user_stickers to authenticated;
