-- Message actions: reply, forward meta, reactions, pins, delete, mark unread

-- ---------------------------------------------------------------------------
-- Reply + forward metadata
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists reply_to_id uuid references public.messages (id) on delete set null,
  add column if not exists forwarded_from jsonb;

alter table public.direct_messages
  add column if not exists reply_to_id uuid references public.direct_messages (id) on delete set null,
  add column if not exists forwarded_from jsonb;

create index if not exists messages_reply_to_idx on public.messages (reply_to_id);
create index if not exists direct_messages_reply_to_idx on public.direct_messages (reply_to_id);

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id);

create table if not exists public.dm_message_reactions (
  message_id uuid not null references public.direct_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists dm_message_reactions_message_idx
  on public.dm_message_reactions (message_id);

alter table public.message_reactions enable row level security;
alter table public.dm_message_reactions enable row level security;

drop policy if exists "View channel message reactions" on public.message_reactions;
create policy "View channel message reactions"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.can_view_channel(m.channel_id)
    )
  );

drop policy if exists "React to channel messages" on public.message_reactions;
create policy "React to channel messages"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.can_view_channel(m.channel_id)
    )
  );

drop policy if exists "Remove own channel reactions" on public.message_reactions;
create policy "Remove own channel reactions"
  on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "View dm message reactions" on public.dm_message_reactions;
create policy "View dm message reactions"
  on public.dm_message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.direct_messages dm
      where dm.id = dm_message_reactions.message_id
        and public.is_dm_member(dm.conversation_id)
    )
  );

drop policy if exists "React to dm messages" on public.dm_message_reactions;
create policy "React to dm messages"
  on public.dm_message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.direct_messages dm
      where dm.id = dm_message_reactions.message_id
        and public.is_dm_member(dm.conversation_id)
    )
  );

drop policy if exists "Remove own dm reactions" on public.dm_message_reactions;
create policy "Remove own dm reactions"
  on public.dm_message_reactions for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.message_reactions to authenticated;
grant select, insert, delete on public.dm_message_reactions to authenticated;

-- ---------------------------------------------------------------------------
-- Channel pins
-- ---------------------------------------------------------------------------
create table if not exists public.channel_pins (
  channel_id uuid not null references public.channels (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  pinned_by uuid not null references public.profiles (id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (message_id),
  unique (channel_id, message_id)
);

create index if not exists channel_pins_channel_idx on public.channel_pins (channel_id);

alter table public.channel_pins enable row level security;

drop policy if exists "Members view channel pins" on public.channel_pins;
create policy "Members view channel pins"
  on public.channel_pins for select to authenticated
  using (public.can_view_channel(channel_id));

drop policy if exists "Staff pin messages" on public.channel_pins;
create policy "Staff pin messages"
  on public.channel_pins for insert to authenticated
  with check (
    pinned_by = auth.uid()
    and public.can_view_channel(channel_id)
    and exists (
      select 1 from public.channels c
      where c.id = channel_pins.channel_id
        and public.is_group_staff(c.group_id)
    )
    and exists (
      select 1 from public.messages m
      where m.id = channel_pins.message_id
        and m.channel_id = channel_pins.channel_id
    )
  );

drop policy if exists "Staff unpin messages" on public.channel_pins;
create policy "Staff unpin messages"
  on public.channel_pins for delete to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_pins.channel_id
        and public.is_group_staff(c.group_id)
    )
  );

grant select, insert, delete on public.channel_pins to authenticated;

-- ---------------------------------------------------------------------------
-- Delete messages
-- ---------------------------------------------------------------------------
drop policy if exists "Authors delete own channel messages" on public.messages;
create policy "Authors delete own channel messages"
  on public.messages for delete to authenticated
  using (
    author_id = auth.uid()
    and public.can_view_channel(channel_id)
  );

drop policy if exists "Staff delete channel messages" on public.messages;
create policy "Staff delete channel messages"
  on public.messages for delete to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = messages.channel_id
        and public.is_group_staff(c.group_id)
    )
  );

drop policy if exists "Authors delete own dm messages" on public.direct_messages;
create policy "Authors delete own dm messages"
  on public.direct_messages for delete to authenticated
  using (
    author_id = auth.uid()
    and public.is_dm_member(conversation_id)
  );

grant delete on public.messages to authenticated;
grant delete on public.direct_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Mark unread
-- ---------------------------------------------------------------------------
create or replace function public.mark_channel_unread(
  p_channel_id uuid,
  p_message_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.can_view_channel(p_channel_id) then
    raise exception 'Cannot view channel';
  end if;
  insert into public.channel_read_state (user_id, channel_id, last_read_at)
  values (auth.uid(), p_channel_id, p_message_created_at - interval '1 millisecond')
  on conflict (user_id, channel_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.mark_dm_unread(
  p_conversation_id uuid,
  p_message_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_dm_member(p_conversation_id) then
    raise exception 'Not a DM member';
  end if;
  insert into public.dm_read_state (user_id, conversation_id, last_read_at)
  values (auth.uid(), p_conversation_id, p_message_created_at - interval '1 millisecond')
  on conflict (user_id, conversation_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke all on function public.mark_channel_unread(uuid, timestamptz) from public;
revoke all on function public.mark_channel_unread(uuid, timestamptz) from anon;
grant execute on function public.mark_channel_unread(uuid, timestamptz) to authenticated;

revoke all on function public.mark_dm_unread(uuid, timestamptz) from public;
revoke all on function public.mark_dm_unread(uuid, timestamptz) from anon;
grant execute on function public.mark_dm_unread(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.dm_message_reactions;
alter publication supabase_realtime add table public.channel_pins;
