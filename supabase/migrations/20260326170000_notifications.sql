-- Read state, mentions, unread summary RPCs

-- ─── Channel / DM read cursors ─────────────────────────────────────────────
create table if not exists public.channel_read_state (
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

create index if not exists channel_read_state_channel_idx
  on public.channel_read_state (channel_id);

create table if not exists public.dm_read_state (
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.direct_conversations (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create index if not exists dm_read_state_conversation_idx
  on public.dm_read_state (conversation_id);

alter table public.channel_read_state enable row level security;
alter table public.dm_read_state enable row level security;

create policy "Users manage own channel read state"
  on public.channel_read_state for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_view_channel(channel_id));

create policy "Users manage own dm read state"
  on public.dm_read_state for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_dm_member(conversation_id));

-- ─── Message mentions (server channels only) ───────────────────────────────
create table if not exists public.message_mentions (
  message_id uuid not null references public.messages (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, mentioned_user_id)
);

create index if not exists message_mentions_user_idx
  on public.message_mentions (mentioned_user_id);

alter table public.message_mentions enable row level security;

create policy "View mentions in visible channels"
  on public.message_mentions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_mentions.message_id
        and public.can_view_channel(m.channel_id)
    )
  );

create policy "Authors insert mentions on own messages"
  on public.message_mentions for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_mentions.message_id
        and m.author_id = auth.uid()
        and public.can_view_channel(m.channel_id)
    )
  );

-- ─── Mark read ─────────────────────────────────────────────────────────────
create or replace function public.mark_channel_read(p_channel_id uuid)
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
  values (auth.uid(), p_channel_id, now())
  on conflict (user_id, channel_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.mark_dm_read(p_conversation_id uuid)
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
  values (auth.uid(), p_conversation_id, now())
  on conflict (user_id, conversation_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

grant execute on function public.mark_channel_read(uuid) to authenticated;
grant execute on function public.mark_dm_read(uuid) to authenticated;

-- ─── Unread summary ────────────────────────────────────────────────────────
create or replace function public.get_unread_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  dms jsonb;
  channels jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  into dms
  from (
    select
      dcm.conversation_id,
      (
        select count(*)::int
        from public.direct_messages dm
        left join public.dm_read_state rs
          on rs.conversation_id = dcm.conversation_id and rs.user_id = uid
        where dm.conversation_id = dcm.conversation_id
          and dm.author_id <> uid
          and dm.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
      ) as unread_count
    from public.direct_conversation_members dcm
    where dcm.user_id = uid
  ) t
  where t.unread_count > 0;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  into channels
  from (
    select
      c.id as channel_id,
      c.group_id,
      (
        select count(*)::int
        from public.messages m
        left join public.channel_read_state rs
          on rs.channel_id = c.id and rs.user_id = uid
        where m.channel_id = c.id
          and m.author_id <> uid
          and m.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
      ) as unread_count,
      (
        select count(*)::int
        from public.messages m
        join public.message_mentions mm on mm.message_id = m.id
        left join public.channel_read_state rs
          on rs.channel_id = c.id and rs.user_id = uid
        where m.channel_id = c.id
          and mm.mentioned_user_id = uid
          and m.author_id <> uid
          and m.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
      ) as mention_count
    from public.channels c
    where c.type = 'text'
      and public.can_view_channel(c.id)
  ) t
  where t.unread_count > 0 or t.mention_count > 0;

  return jsonb_build_object('dms', dms, 'channels', channels);
end;
$$;

grant execute on function public.get_unread_summary() to authenticated;
