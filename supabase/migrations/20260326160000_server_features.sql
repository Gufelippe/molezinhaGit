-- Theme settings, delete group, invites, private channels, stickers

-- ─── Theme customization ───────────────────────────────────────────────────
alter table public.profiles
  add column if not exists theme_settings jsonb not null default '{}'::jsonb;

-- ─── Private channels ──────────────────────────────────────────────────────
alter table public.channels
  add column if not exists is_private boolean not null default false;

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists channel_members_user_idx
  on public.channel_members (user_id);

alter table public.channel_members enable row level security;

create or replace function public.can_view_channel(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channels c
    where c.id = cid
      and public.is_group_member(c.group_id)
      and (
        not c.is_private
        or public.is_group_staff(c.group_id)
        or exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id and cm.user_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.can_view_channel(uuid) to authenticated;

drop policy if exists "Members can view channels" on public.channels;
create policy "Members can view visible channels"
  on public.channels for select to authenticated
  using (public.can_view_channel(id));

drop policy if exists "Members can view messages" on public.messages;
create policy "Members can view messages in visible channels"
  on public.messages for select to authenticated
  using (public.can_view_channel(channel_id));

drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages in visible channels"
  on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_view_channel(channel_id)
  );

create policy "Staff can view channel members"
  on public.channel_members for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_members.channel_id
        and (
          public.is_group_staff(c.group_id)
          or channel_members.user_id = auth.uid()
        )
    )
  );

create policy "Staff manage channel members"
  on public.channel_members for all to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_members.channel_id
        and public.is_group_staff(c.group_id)
    )
  )
  with check (
    exists (
      select 1 from public.channels c
      where c.id = channel_members.channel_id
        and public.is_group_staff(c.group_id)
    )
  );

create or replace function public.set_channel_private(
  p_channel_id uuid,
  p_is_private boolean
)
returns public.channels
language plpgsql
security definer
set search_path = public
as $$
declare
  ch public.channels;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into ch from public.channels where id = p_channel_id;
  if ch.id is null then
    raise exception 'Channel not found';
  end if;
  if not public.is_group_staff(ch.group_id) then
    raise exception 'Not allowed';
  end if;

  update public.channels
  set is_private = p_is_private
  where id = p_channel_id
  returning * into ch;

  if not p_is_private then
    delete from public.channel_members where channel_id = p_channel_id;
  end if;

  perform public.write_group_audit(
    ch.group_id,
    'channel_privacy',
    null,
    jsonb_build_object('channel_id', ch.id, 'is_private', p_is_private)
  );

  return ch;
end;
$$;

create or replace function public.set_channel_member_access(
  p_channel_id uuid,
  p_user_id uuid,
  p_allow boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ch public.channels;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into ch from public.channels where id = p_channel_id;
  if ch.id is null then
    raise exception 'Channel not found';
  end if;
  if not public.is_group_staff(ch.group_id) then
    raise exception 'Not allowed';
  end if;
  if not ch.is_private then
    raise exception 'Channel is not private';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = ch.group_id and user_id = p_user_id
  ) then
    raise exception 'User is not a group member';
  end if;

  if p_allow then
    insert into public.channel_members (channel_id, user_id)
    values (p_channel_id, p_user_id)
    on conflict do nothing;
  else
    delete from public.channel_members
    where channel_id = p_channel_id and user_id = p_user_id;
  end if;
end;
$$;

grant execute on function public.set_channel_private(uuid, boolean) to authenticated;
grant execute on function public.set_channel_member_access(uuid, uuid, boolean) to authenticated;
grant select, insert, delete on public.channel_members to authenticated;

-- Allow staff to update channel flags
drop policy if exists "Staff can update channels" on public.channels;
create policy "Staff can update channels"
  on public.channels for update to authenticated
  using (public.is_group_staff(group_id))
  with check (public.is_group_staff(group_id));

grant update on public.channels to authenticated;

-- ─── Delete group ──────────────────────────────────────────────────────────
create or replace function public.delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select role into actor_role
  from public.group_members
  where group_id = p_group_id and user_id = auth.uid();

  if actor_role is distinct from 'owner' then
    raise exception 'Only the owner can delete the group';
  end if;

  delete from public.groups where id = p_group_id;
end;
$$;

grant execute on function public.delete_group(uuid) to authenticated;

-- ─── Regenerate invite ─────────────────────────────────────────────────────
create or replace function public.regenerate_group_invite(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_group_staff(p_group_id) then
    raise exception 'Not allowed';
  end if;

  new_code := encode(gen_random_bytes(6), 'hex');
  update public.groups
  set invite_code = new_code
  where id = p_group_id;

  perform public.write_group_audit(
    p_group_id,
    'invite_regenerated',
    null,
    '{}'::jsonb
  );

  return new_code;
end;
$$;

grant execute on function public.regenerate_group_invite(uuid) to authenticated;

-- ─── Stickers ──────────────────────────────────────────────────────────────
create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  file_url text not null,
  mime_type text not null default 'image/png',
  width int,
  height int,
  byte_size int,
  created_at timestamptz not null default now(),
  constraint stickers_name_len check (char_length(trim(name)) between 1 and 32)
);

create index if not exists stickers_owner_idx on public.stickers (owner_id, created_at desc);

alter table public.messages
  add column if not exists sticker_id uuid references public.stickers (id) on delete set null;

alter table public.direct_messages
  add column if not exists sticker_id uuid references public.stickers (id) on delete set null;

alter table public.stickers enable row level security;

create policy "Authenticated can view stickers"
  on public.stickers for select to authenticated
  using (true);

create policy "Users insert own stickers"
  on public.stickers for insert to authenticated
  with check (owner_id = auth.uid());

create policy "Users update own stickers"
  on public.stickers for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "Users delete own stickers"
  on public.stickers for delete to authenticated
  using (owner_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('stickers', 'stickers', true)
on conflict (id) do nothing;

create policy "Sticker images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'stickers');

create policy "Users can upload own stickers"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'stickers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own stickers"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'stickers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own stickers"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'stickers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

grant select, insert, update, delete on public.stickers to authenticated;
