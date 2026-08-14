-- Kick / ban members from a group. Bans block re-join via invite.

create table if not exists public.group_bans (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  banned_by uuid references public.profiles (id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id),
  constraint group_bans_reason_len check (reason is null or char_length(reason) <= 200)
);

create index if not exists group_bans_user_idx on public.group_bans (user_id);

alter table public.group_bans enable row level security;

drop policy if exists "Staff can view group bans" on public.group_bans;
create policy "Staff can view group bans"
  on public.group_bans for select to authenticated
  using (public.is_group_staff(group_id));

grant select on public.group_bans to authenticated;

create or replace function public.member_role_rank(p_role text)
returns int
language sql
immutable
as $$
  select case p_role
    when 'owner' then 3
    when 'admin' then 2
    when 'member' then 1
    else 0
  end;
$$;

create or replace function public.remove_group_member(
  p_group_id uuid,
  p_user_id uuid,
  p_ban boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target_role text;
  clean_reason text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Você não pode se expulsar';
  end if;

  select role into actor_role
  from public.group_members
  where group_id = p_group_id and user_id = auth.uid();

  if actor_role is null or public.member_role_rank(actor_role) < 2 then
    raise exception 'Sem permissão';
  end if;

  select role into target_role
  from public.group_members
  where group_id = p_group_id and user_id = p_user_id;

  if target_role is null then
    raise exception 'Membro não encontrado';
  end if;

  if public.member_role_rank(actor_role) <= public.member_role_rank(target_role) then
    raise exception 'Você não pode moderar este membro';
  end if;

  clean_reason := nullif(trim(coalesce(p_reason, '')), '');
  if clean_reason is not null and char_length(clean_reason) > 200 then
    clean_reason := left(clean_reason, 200);
  end if;

  -- Drop private-channel grants and boot them from any voice channel in this group.
  delete from public.channel_members cm
  using public.channels c
  where cm.channel_id = c.id
    and c.group_id = p_group_id
    and cm.user_id = p_user_id;

  update public.profiles
  set voice_channel_id = null
  where id = p_user_id
    and voice_channel_id in (select id from public.channels where group_id = p_group_id);

  if p_ban then
    insert into public.group_bans (group_id, user_id, banned_by, reason)
    values (p_group_id, p_user_id, auth.uid(), clean_reason)
    on conflict (group_id, user_id) do update
      set banned_by = excluded.banned_by,
          reason = excluded.reason,
          created_at = now();
  end if;

  delete from public.group_members
  where group_id = p_group_id and user_id = p_user_id;

  perform public.write_group_audit(
    p_group_id,
    case when p_ban then 'banned' else 'kicked' end,
    p_user_id,
    jsonb_build_object('reason', clean_reason)
  );
end;
$$;

create or replace function public.unban_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not public.is_group_staff(p_group_id) then
    raise exception 'Sem permissão';
  end if;

  delete from public.group_bans
  where group_id = p_group_id and user_id = p_user_id;

  if not found then
    raise exception 'Este usuário não está banido';
  end if;

  perform public.write_group_audit(p_group_id, 'unbanned', p_user_id, '{}'::jsonb);
end;
$$;

-- Block banned users from rejoining
drop function if exists public.join_group_by_invite(text);
create function public.join_group_by_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups%rowtype;
  uid uuid := auth.uid();
  joined_uid uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select * into g
  from public.groups
  where invite_code = lower(trim(p_code))
  for update;
  if not found then
    raise exception 'invalid invite';
  end if;
  if exists (
    select 1 from public.group_bans b
    where b.group_id = g.id and b.user_id = uid
  ) then
    raise exception 'banned';
  end if;
  if g.invite_expires_at is not null and g.invite_expires_at < now() then
    raise exception 'invite expired';
  end if;
  if g.invite_max_uses is not null and g.invite_use_count >= g.invite_max_uses then
    raise exception 'invite exhausted';
  end if;
  insert into public.group_members (group_id, user_id, role)
  values (g.id, uid, 'member')
  on conflict (group_id, user_id) do nothing
  returning user_id into joined_uid;
  if joined_uid is not null then
    update public.groups set invite_use_count = invite_use_count + 1 where id = g.id;
  end if;
  return g.id;
end;
$$;

do $$
begin
  begin
    alter publication supabase_realtime add table public.group_members;
  exception
    when duplicate_object then null;
  end;
end $$;

revoke all on function public.member_role_rank(text) from public, anon;
grant execute on function public.member_role_rank(text) to authenticated;

revoke all on function public.remove_group_member(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid, boolean, text) to authenticated;

revoke all on function public.unban_group_member(uuid, uuid) from public, anon;
grant execute on function public.unban_group_member(uuid, uuid) to authenticated;

revoke all on function public.join_group_by_invite(text) from public, anon;
grant execute on function public.join_group_by_invite(text) to authenticated;
