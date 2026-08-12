-- Friendships + DM requires accepted friendship

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_not_self check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_unique
  on public.friendships (
    (least(requester_id, addressee_id)),
    (greatest(requester_id, addressee_id))
  );

create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);
create index if not exists friendships_status_idx on public.friendships (status);

create trigger friendships_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a)
      )
  );
$$;

create or replace function public.send_friend_request(p_username text)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles;
  existing public.friendships;
  created public.friendships;
  clean text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  clean := lower(trim(both from p_username));
  clean := regexp_replace(clean, '^@', '');
  if char_length(clean) < 1 then
    raise exception 'Username inválido';
  end if;

  select * into target from public.profiles where lower(username) = clean;
  if target.id is null then
    raise exception 'Usuário não encontrado';
  end if;
  if target.id = auth.uid() then
    raise exception 'Não pode adicionar a si mesmo';
  end if;

  select * into existing
  from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(auth.uid(), target.id)
    and greatest(f.requester_id, f.addressee_id) = greatest(auth.uid(), target.id);

  if existing.id is not null then
    if existing.status = 'accepted' then
      raise exception 'Já são amigos';
    end if;
    if existing.status = 'pending' then
      raise exception 'Pedido já pendente';
    end if;
    -- rejected: allow re-request as new pending from current user
    update public.friendships
    set requester_id = auth.uid(),
        addressee_id = target.id,
        status = 'pending',
        updated_at = now()
    where id = existing.id
    returning * into created;
    return created;
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (auth.uid(), target.id, 'pending')
  returning * into created;

  return created;
end;
$$;

create or replace function public.respond_friend_request(p_friendship_id uuid, p_accept boolean)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.friendships;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into f from public.friendships where id = p_friendship_id;
  if f.id is null then
    raise exception 'Pedido não encontrado';
  end if;
  if f.addressee_id <> auth.uid() then
    raise exception 'Só quem recebeu pode responder';
  end if;
  if f.status <> 'pending' then
    raise exception 'Pedido não está pendente';
  end if;

  update public.friendships
  set status = case when p_accept then 'accepted' else 'rejected' end,
      updated_at = now()
  where id = p_friendship_id
  returning * into f;

  return f;
end;
$$;

create or replace function public.remove_friend(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.friendships f
  where f.status = 'accepted'
    and (
      (f.requester_id = auth.uid() and f.addressee_id = p_user_id)
      or (f.requester_id = p_user_id and f.addressee_id = auth.uid())
    );
end;
$$;

-- DM requires friendship
create or replace function public.get_or_create_dm(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if other_user_id = auth.uid() then
    raise exception 'Cannot DM yourself';
  end if;
  if not public.are_friends(auth.uid(), other_user_id) then
    raise exception 'Vocês precisam ser amigos para conversar no privado';
  end if;

  select m1.conversation_id into cid
  from public.direct_conversation_members m1
  join public.direct_conversation_members m2
    on m1.conversation_id = m2.conversation_id
  where m1.user_id = auth.uid() and m2.user_id = other_user_id
  limit 1;

  if cid is not null then
    return cid;
  end if;

  insert into public.direct_conversations default values returning id into cid;
  insert into public.direct_conversation_members (conversation_id, user_id) values
    (cid, auth.uid()),
    (cid, other_user_id);

  return cid;
end;
$$;

alter table public.friendships enable row level security;

drop policy if exists "Users see own friendships" on public.friendships;
create policy "Users see own friendships"
  on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Mutations go through RPCs (security definer)
grant select on public.friendships to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.friendships;
exception
  when duplicate_object then null;
end $$;
