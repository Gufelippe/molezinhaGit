-- Phase 2–4: presence, group branding, announcements, polls, bookmarks, invites, mutes, DND, activity

-- ---------------------------------------------------------------------------
-- Presence: idle + dnd
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check
  check (status in ('online', 'idle', 'dnd', 'offline', 'in_call'));

alter table public.profiles
  add column if not exists dnd_start time,
  add column if not exists dnd_end time,
  add column if not exists activity jsonb;

-- ---------------------------------------------------------------------------
-- Group branding
-- ---------------------------------------------------------------------------
alter table public.groups
  add column if not exists accent_color text not null default '#1f6f5b',
  add column if not exists wallpaper_url text;

insert into storage.buckets (id, name, public)
values ('group-assets', 'group-assets', true)
on conflict (id) do nothing;

drop policy if exists "Group assets publicly readable" on storage.objects;
create policy "Group assets publicly readable"
  on storage.objects for select
  using (bucket_id = 'group-assets');

drop policy if exists "Staff upload group assets" on storage.objects;
create policy "Staff upload group assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-assets'
    and public.is_group_staff(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "Staff update group assets" on storage.objects;
create policy "Staff update group assets"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'group-assets'
    and public.is_group_staff(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "Staff delete group assets" on storage.objects;
create policy "Staff delete group assets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'group-assets'
    and public.is_group_staff(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- Announcement channels
-- ---------------------------------------------------------------------------
alter table public.channels drop constraint if exists channels_type_check;
alter table public.channels
  add constraint channels_type_check
  check (type in ('text', 'voice', 'announcement'));

-- Restrict inserts on announcement channels to staff
drop policy if exists "Members can send messages in visible channels" on public.messages;
create policy "Members can send messages in visible channels"
  on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_view_channel(channel_id)
    and exists (
      select 1 from public.channels c
      where c.id = channel_id
        and (
          c.type <> 'announcement'
          or public.is_group_staff(c.group_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Polls
-- ---------------------------------------------------------------------------
create table if not exists public.message_polls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.messages (id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 200),
  created_at timestamptz not null default now()
);

create table if not exists public.message_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.message_polls (id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 80),
  position int not null default 0
);

create table if not exists public.message_poll_votes (
  poll_id uuid not null references public.message_polls (id) on delete cascade,
  option_id uuid not null references public.message_poll_options (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

alter table public.message_polls enable row level security;
alter table public.message_poll_options enable row level security;
alter table public.message_poll_votes enable row level security;

drop policy if exists "View polls in visible channels" on public.message_polls;
create policy "View polls in visible channels"
  on public.message_polls for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_polls.message_id and public.can_view_channel(m.channel_id)
    )
  );

drop policy if exists "Create poll on own message" on public.message_polls;
create policy "Create poll on own message"
  on public.message_polls for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_polls.message_id
        and m.author_id = auth.uid()
        and public.can_view_channel(m.channel_id)
    )
  );

drop policy if exists "View poll options" on public.message_poll_options;
create policy "View poll options"
  on public.message_poll_options for select to authenticated
  using (
    exists (
      select 1 from public.message_polls p
      join public.messages m on m.id = p.message_id
      where p.id = message_poll_options.poll_id and public.can_view_channel(m.channel_id)
    )
  );

drop policy if exists "Insert poll options with poll" on public.message_poll_options;
create policy "Insert poll options with poll"
  on public.message_poll_options for insert to authenticated
  with check (
    exists (
      select 1 from public.message_polls p
      join public.messages m on m.id = p.message_id
      where p.id = message_poll_options.poll_id
        and m.author_id = auth.uid()
        and public.can_view_channel(m.channel_id)
    )
  );

drop policy if exists "View poll votes" on public.message_poll_votes;
create policy "View poll votes"
  on public.message_poll_votes for select to authenticated
  using (
    exists (
      select 1 from public.message_polls p
      join public.messages m on m.id = p.message_id
      where p.id = message_poll_votes.poll_id and public.can_view_channel(m.channel_id)
    )
  );

drop policy if exists "Cast own poll vote" on public.message_poll_votes;
create policy "Cast own poll vote"
  on public.message_poll_votes for insert to authenticated
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
  );

drop policy if exists "Change own poll vote" on public.message_poll_votes;
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
  );

drop policy if exists "Remove own poll vote" on public.message_poll_votes;
create policy "Remove own poll vote"
  on public.message_poll_votes for delete to authenticated
  using (user_id = auth.uid());

grant select, insert on public.message_polls to authenticated;
grant select, insert on public.message_poll_options to authenticated;
grant select, insert, update, delete on public.message_poll_votes to authenticated;

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

-- ---------------------------------------------------------------------------
-- Bookmarks
-- ---------------------------------------------------------------------------
create table if not exists public.user_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  dm_message_id uuid references public.direct_messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_bookmarks_one_target check (
    (message_id is not null and dm_message_id is null)
    or (message_id is null and dm_message_id is not null)
  ),
  unique (user_id, message_id),
  unique (user_id, dm_message_id)
);

alter table public.user_bookmarks enable row level security;

drop policy if exists "Own bookmarks" on public.user_bookmarks;
create policy "Own bookmarks"
  on public.user_bookmarks for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, delete on public.user_bookmarks to authenticated;

-- ---------------------------------------------------------------------------
-- Invite preview + optional expiry/max uses
-- ---------------------------------------------------------------------------
alter table public.groups
  add column if not exists invite_expires_at timestamptz,
  add column if not exists invite_max_uses int,
  add column if not exists invite_use_count int not null default 0;

drop function if exists public.preview_group_invite(text);
create or replace function public.preview_group_invite(p_code text)
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

-- init.sql created this returning public.groups, so the type change needs a drop.
drop function if exists public.join_group_by_invite(text);
create or replace function public.join_group_by_invite(p_code text)
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
  -- Only consume invite quota when membership was actually created.
  if joined_uid is not null then
    update public.groups set invite_use_count = invite_use_count + 1 where id = g.id;
  end if;
  return g.id;
end;
$$;

revoke all on function public.join_group_by_invite(text) from public, anon;
grant execute on function public.join_group_by_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Mutes
-- ---------------------------------------------------------------------------
create table if not exists public.channel_mutes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

create table if not exists public.group_mutes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

alter table public.channel_mutes enable row level security;
alter table public.group_mutes enable row level security;

drop policy if exists "Own channel mutes" on public.channel_mutes;
create policy "Own channel mutes"
  on public.channel_mutes for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Own group mutes" on public.group_mutes;
create policy "Own group mutes"
  on public.group_mutes for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, delete on public.channel_mutes to authenticated;
grant select, insert, delete on public.group_mutes to authenticated;

-- ---------------------------------------------------------------------------
-- Mutual groups
-- ---------------------------------------------------------------------------
create or replace function public.mutual_groups(p_other uuid)
returns table (id uuid, name text, icon_url text)
language sql
security definer
set search_path = public
as $$
  select g.id, g.name, g.icon_url
  from public.groups g
  where exists (
    select 1 from public.group_members a
    where a.group_id = g.id and a.user_id = auth.uid()
  )
  and exists (
    select 1 from public.group_members b
    where b.group_id = g.id and b.user_id = p_other
  )
  order by g.name;
$$;

revoke all on function public.mutual_groups(uuid) from public, anon;
grant execute on function public.mutual_groups(uuid) to authenticated;
