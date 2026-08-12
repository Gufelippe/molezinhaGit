-- Group staff helpers, role management, channel RPCs, audit log

create table if not exists public.group_audit_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  target_user_id uuid references public.profiles (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists group_audit_logs_group_created_idx
  on public.group_audit_logs (group_id, created_at desc);

create or replace function public.is_group_staff(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = gid
      and gm.user_id = auth.uid()
      and gm.role in ('owner', 'admin')
  );
$$;

create or replace function public.write_group_audit(
  p_group_id uuid,
  p_action text,
  p_target_user_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_audit_logs (group_id, actor_id, action, target_user_id, meta)
  values (p_group_id, auth.uid(), p_action, p_target_user_id, coalesce(p_meta, '{}'::jsonb));
end;
$$;

create or replace function public.set_member_role(
  p_group_id uuid,
  p_user_id uuid,
  p_role text
)
returns public.group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target public.group_members;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Invalid role';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Cannot change your own role';
  end if;

  select role into actor_role
  from public.group_members
  where group_id = p_group_id and user_id = auth.uid();

  if actor_role is distinct from 'owner' then
    raise exception 'Only the owner can change roles';
  end if;

  select * into target
  from public.group_members
  where group_id = p_group_id and user_id = p_user_id;

  if target.user_id is null then
    raise exception 'Member not found';
  end if;
  if target.role = 'owner' then
    raise exception 'Cannot change owner role';
  end if;

  update public.group_members
  set role = p_role
  where group_id = p_group_id and user_id = p_user_id
  returning * into target;

  perform public.write_group_audit(
    p_group_id,
    'role_changed',
    p_user_id,
    jsonb_build_object('role', p_role)
  );

  return target;
end;
$$;

create or replace function public.create_channel(
  p_group_id uuid,
  p_name text,
  p_type text
)
returns public.channels
language plpgsql
security definer
set search_path = public
as $$
declare
  ch public.channels;
  next_pos int;
  clean_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_group_staff(p_group_id) then
    raise exception 'Not allowed';
  end if;
  if p_type not in ('text', 'voice') then
    raise exception 'Invalid channel type';
  end if;

  clean_name := lower(trim(p_name));
  clean_name := regexp_replace(clean_name, '\s+', '-', 'g');
  clean_name := regexp_replace(clean_name, '[^a-z0-9\-_]', '', 'g');
  if char_length(clean_name) < 1 then
    raise exception 'Invalid channel name';
  end if;

  select coalesce(max(position), -1) + 1 into next_pos
  from public.channels
  where group_id = p_group_id;

  insert into public.channels (group_id, name, type, position)
  values (p_group_id, clean_name, p_type, next_pos)
  returning * into ch;

  perform public.write_group_audit(
    p_group_id,
    'channel_created',
    null,
    jsonb_build_object('channel_id', ch.id, 'name', ch.name, 'type', ch.type)
  );

  return ch;
end;
$$;

create or replace function public.delete_channel(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ch public.channels;
  text_count int;
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

  if ch.type = 'text' then
    select count(*) into text_count
    from public.channels
    where group_id = ch.group_id and type = 'text';
    if text_count <= 1 then
      raise exception 'Cannot delete the last text channel';
    end if;
  end if;

  perform public.write_group_audit(
    ch.group_id,
    'channel_deleted',
    null,
    jsonb_build_object('channel_id', ch.id, 'name', ch.name, 'type', ch.type)
  );

  delete from public.channels where id = p_channel_id;
end;
$$;

alter table public.group_audit_logs enable row level security;

drop policy if exists "Staff can view audit logs" on public.group_audit_logs;
create policy "Staff can view audit logs"
  on public.group_audit_logs for select to authenticated
  using (public.is_group_staff(group_id));

grant select on public.group_audit_logs to authenticated;
grant execute on function public.is_group_staff(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.create_channel(uuid, text, text) to authenticated;
grant execute on function public.delete_channel(uuid) to authenticated;
