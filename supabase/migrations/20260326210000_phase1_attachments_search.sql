-- Phase 1: message attachments + search_messages RPC

-- Allow attachment-only messages (placeholder content still required by check > 0)
-- Attachments table
create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages (id) on delete cascade,
  dm_message_id uuid references public.direct_messages (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  file_url text not null,
  file_name text not null default 'file',
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  width int,
  height int,
  created_at timestamptz not null default now(),
  constraint message_attachments_one_parent check (
    (message_id is not null and dm_message_id is null)
    or (message_id is null and dm_message_id is not null)
  )
);

create index if not exists message_attachments_message_idx
  on public.message_attachments (message_id) where message_id is not null;
create index if not exists message_attachments_dm_idx
  on public.message_attachments (dm_message_id) where dm_message_id is not null;

alter table public.message_attachments enable row level security;

drop policy if exists "View channel message attachments" on public.message_attachments;
create policy "View channel message attachments"
  on public.message_attachments for select to authenticated
  using (
    (
      message_id is not null
      and exists (
        select 1 from public.messages m
        where m.id = message_attachments.message_id
          and public.can_view_channel(m.channel_id)
      )
    )
    or (
      dm_message_id is not null
      and exists (
        select 1 from public.direct_messages dm
        where dm.id = message_attachments.dm_message_id
          and public.is_dm_member(dm.conversation_id)
      )
    )
  );

drop policy if exists "Upload channel message attachments" on public.message_attachments;
create policy "Upload channel message attachments"
  on public.message_attachments for insert to authenticated
  with check (
    uploader_id = auth.uid()
    and (
      (
        message_id is not null
        and exists (
          select 1 from public.messages m
          where m.id = message_attachments.message_id
            and m.author_id = auth.uid()
            and public.can_view_channel(m.channel_id)
        )
      )
      or (
        dm_message_id is not null
        and exists (
          select 1 from public.direct_messages dm
          where dm.id = message_attachments.dm_message_id
            and dm.author_id = auth.uid()
            and public.is_dm_member(dm.conversation_id)
        )
      )
    )
  );

drop policy if exists "Delete own message attachments" on public.message_attachments;
create policy "Delete own message attachments"
  on public.message_attachments for delete to authenticated
  using (uploader_id = auth.uid());

grant select, insert, delete on public.message_attachments to authenticated;

insert into storage.buckets (id, name, public)
values ('message-media', 'message-media', true)
on conflict (id) do nothing;

drop policy if exists "Message media publicly readable" on storage.objects;
create policy "Message media publicly readable"
  on storage.objects for select
  using (bucket_id = 'message-media');

drop policy if exists "Users upload own message media" on storage.objects;
create policy "Users upload own message media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own message media" on storage.objects;
create policy "Users update own message media"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'message-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own message media" on storage.objects;
create policy "Users delete own message media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'message-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Search messages in a channel or DM conversation
drop function if exists public.search_messages(text, uuid, text, int);
create function public.search_messages(
  p_scope text,
  p_id uuid,
  p_query text,
  p_limit int default 40
)
returns table (
  id uuid,
  content text,
  author_id uuid,
  created_at timestamptz,
  author_display_name text,
  author_username text,
  author_avatar_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  q text := trim(p_query);
  lim int := least(greatest(coalesce(p_limit, 40), 1), 80);
begin
  if q is null or char_length(q) < 1 then
    return;
  end if;

  if p_scope = 'channel' then
    if not public.can_view_channel(p_id) then
      raise exception 'forbidden';
    end if;
    return query
    select
      m.id,
      m.content,
      m.author_id,
      m.created_at,
      p.display_name,
      p.username,
      p.avatar_url
    from public.messages m
    join public.profiles p on p.id = m.author_id
    where m.channel_id = p_id
      and m.content ilike '%' || q || '%'
    order by m.created_at desc
    limit lim;
  elsif p_scope = 'dm' then
    if not public.is_dm_member(p_id) then
      raise exception 'forbidden';
    end if;
    return query
    select
      m.id,
      m.content,
      m.author_id,
      m.created_at,
      p.display_name,
      p.username,
      p.avatar_url
    from public.direct_messages m
    join public.profiles p on p.id = m.author_id
    where m.conversation_id = p_id
      and m.content ilike '%' || q || '%'
    order by m.created_at desc
    limit lim;
  else
    raise exception 'invalid scope';
  end if;
end;
$$;

revoke all on function public.search_messages(text, uuid, text, int) from public, anon;
grant execute on function public.search_messages(text, uuid, text, int) to authenticated;

-- Realtime so remote clients receive attachments without refresh
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
