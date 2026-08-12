-- Bugfixes safe to run even if phase1/phase2 tables are not all present yet.
-- Prefer running in order: ...200000 → 210000 → 220000 → this file.
-- This file alone will no-op missing pieces instead of failing.

-- Ensure DM forward column exists if a broken apply left it missing
alter table public.direct_messages
  add column if not exists forwarded_from jsonb;

-- Invite columns used by the fixed RPCs (no-op if phase2 already added them)
alter table public.groups
  add column if not exists accent_color text not null default '#1f6f5b',
  add column if not exists invite_expires_at timestamptz,
  add column if not exists invite_max_uses int,
  add column if not exists invite_use_count int not null default 0;

-- Realtime publications only when the relation exists
do $$
begin
  if to_regclass('public.message_attachments') is not null then
    begin
      alter publication supabase_realtime add table public.message_attachments;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

do $$
begin
  if to_regclass('public.message_poll_votes') is not null then
    begin
      alter publication supabase_realtime add table public.message_poll_votes;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

do $$
begin
  if to_regclass('public.message_polls') is not null then
    begin
      alter publication supabase_realtime add table public.message_polls;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

-- Poll vote UPDATE must validate option belongs to poll (skip if polls not migrated yet)
do $$
begin
  if to_regclass('public.message_poll_votes') is null then
    return;
  end if;
  execute 'drop policy if exists "Change own poll vote" on public.message_poll_votes';
  execute $pol$
    create policy "Change own poll vote"
      on public.message_poll_votes for update to authenticated
      using (user_id = auth.uid())
      with check (
        user_id = auth.uid()
        and exists (
          select 1 from public.message_polls p
          join public.messages m on m.id = p.message_id
          where p.id = message_poll_votes.poll_id and public.can_view_channel(m.channel_id)
        )
        and exists (
          select 1 from public.message_poll_options o
          where o.id = option_id and o.poll_id = message_poll_votes.poll_id
        )
      )
  $pol$;
end $$;

-- Invite: only increment use count on new membership; case-insensitive code
-- init.sql declared this as `returns public.groups` with arg `code`, so replacing
-- it in place fails with 42P13; drop first, then recreate and re-grant below.
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

revoke all on function public.join_group_by_invite(text) from public, anon;
grant execute on function public.join_group_by_invite(text) to authenticated;

drop function if exists public.preview_group_invite(text);
create function public.preview_group_invite(p_code text)
returns table (
  name text,
  icon_url text,
  accent_color text,
  member_count bigint,
  invite_valid boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups%rowtype;
begin
  select * into g from public.groups where invite_code = lower(trim(p_code)) limit 1;
  if not found then
    return query select null::text, null::text, null::text, 0::bigint, false;
    return;
  end if;
  if g.invite_expires_at is not null and g.invite_expires_at < now() then
    return query select g.name, g.icon_url, g.accent_color, 0::bigint, false;
    return;
  end if;
  if g.invite_max_uses is not null and g.invite_use_count >= g.invite_max_uses then
    return query select g.name, g.icon_url, g.accent_color, 0::bigint, false;
    return;
  end if;
  return query
  select
    g.name,
    g.icon_url,
    g.accent_color,
    (select count(*) from public.group_members gm where gm.group_id = g.id),
    true;
end;
$$;

revoke all on function public.preview_group_invite(text) from public, anon;
grant execute on function public.preview_group_invite(text) to authenticated;
