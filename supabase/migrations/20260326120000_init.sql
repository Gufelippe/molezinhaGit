-- Molezinha schema: profiles, groups, channels, messages, DMs + RLS

create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  display_name text not null,
  avatar_url text,
  bio text,
  theme text not null default 'dark' check (theme in ('light', 'dark', 'system')),
  mute_on_join boolean not null default false,
  message_sound boolean not null default true,
  status text not null default 'offline' check (status in ('online', 'offline', 'in_call')),
  voice_channel_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_url text,
  invite_code text unique not null default encode(gen_random_bytes(6), 'hex'),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null,
  type text not null check (type in ('text', 'voice')),
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_voice_channel_fk
  foreign key (voice_channel_id) references public.channels (id) on delete set null;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) > 0 and char_length(content) <= 4000),
  created_at timestamptz not null default now()
);

create table public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.direct_conversation_members (
  conversation_id uuid not null references public.direct_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) > 0 and char_length(content) <= 4000),
  created_at timestamptz not null default now()
);

create index messages_channel_created_idx on public.messages (channel_id, created_at desc);
create index dm_conversation_created_idx on public.direct_messages (conversation_id, created_at desc);
create index channels_group_idx on public.channels (group_id, position);

-- Auto profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
begin
  uname := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    split_part(new.email, '@', 1)
  );
  insert into public.profiles (id, username, display_name, theme)
  values (
    new.id,
    uname,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), uname),
    coalesce(nullif(trim(new.raw_user_meta_data->>'theme'), ''), 'dark')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Helpers for RLS
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = gid and gm.user_id = auth.uid()
  );
$$;

create or replace function public.is_dm_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.direct_conversation_members m
    where m.conversation_id = cid and m.user_id = auth.uid()
  );
$$;

-- Create group with default channels + owner membership
create or replace function public.create_group_with_defaults(group_name text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.groups (name, owner_id)
  values (group_name, auth.uid())
  returning * into g;

  insert into public.group_members (group_id, user_id, role)
  values (g.id, auth.uid(), 'owner');

  insert into public.channels (group_id, name, type, position) values
    (g.id, 'geral', 'text', 0),
    (g.id, 'voz', 'voice', 1);

  return g;
end;
$$;

create or replace function public.join_group_by_invite(code text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into g from public.groups where invite_code = lower(trim(code));
  if g.id is null then
    raise exception 'Invalid invite code';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (g.id, auth.uid(), 'member')
  on conflict do nothing;

  return g;
end;
$$;

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

-- RLS
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;
alter table public.direct_conversations enable row level security;
alter table public.direct_conversation_members enable row level security;
alter table public.direct_messages enable row level security;

create policy "Profiles are viewable by authenticated users"
  on public.profiles for select to authenticated using (true);

create policy "Users update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "Group members can view groups"
  on public.groups for select to authenticated
  using (public.is_group_member(id));

create policy "Authenticated can create groups"
  on public.groups for insert to authenticated
  with check (owner_id = auth.uid());

create policy "Owners can update groups"
  on public.groups for update to authenticated
  using (owner_id = auth.uid());

create policy "Members can view memberships of their groups"
  on public.group_members for select to authenticated
  using (public.is_group_member(group_id) or user_id = auth.uid());

create policy "Users can insert themselves as members via functions"
  on public.group_members for insert to authenticated
  with check (user_id = auth.uid());

create policy "Members can view channels"
  on public.channels for select to authenticated
  using (public.is_group_member(group_id));

create policy "Owners/admins can insert channels"
  on public.channels for insert to authenticated
  with check (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = channels.group_id
        and gm.user_id = auth.uid()
        and gm.role in ('owner', 'admin')
    )
  );

create policy "Members can view messages"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = messages.channel_id and public.is_group_member(c.group_id)
    )
  );

create policy "Members can send messages"
  on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.channels c
      where c.id = messages.channel_id and public.is_group_member(c.group_id)
    )
  );

create policy "DM members can view conversations"
  on public.direct_conversations for select to authenticated
  using (public.is_dm_member(id));

create policy "DM members can view members"
  on public.direct_conversation_members for select to authenticated
  using (public.is_dm_member(conversation_id));

create policy "DM members can view messages"
  on public.direct_messages for select to authenticated
  using (public.is_dm_member(conversation_id));

create policy "DM members can send messages"
  on public.direct_messages for insert to authenticated
  with check (
    author_id = auth.uid() and public.is_dm_member(conversation_id)
  );

-- Realtime
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.direct_messages;
alter publication supabase_realtime add table public.profiles;

-- Storage for avatars
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Avatar images are publicly accessible"
  on storage.objects for select using (bucket_id = 'avatars');

create policy "Users can upload own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.groups to authenticated;
grant select, insert on public.group_members to authenticated;
grant select, insert on public.channels to authenticated;
grant select, insert on public.messages to authenticated;
grant select on public.direct_conversations to authenticated;
grant select on public.direct_conversation_members to authenticated;
grant select, insert on public.direct_messages to authenticated;
grant execute on function public.create_group_with_defaults(text) to authenticated;
grant execute on function public.join_group_by_invite(text) to authenticated;
grant execute on function public.get_or_create_dm(uuid) to authenticated;
