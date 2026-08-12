-- Harden functions + storage against Supabase security linter warnings.
-- Note: Auth "Leaked password protection" is a Dashboard setting (Auth → Providers / Password),
-- not fixable via SQL.

-- ---------------------------------------------------------------------------
-- 1) Function Search Path Mutable — set_updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Public buckets — drop broad SELECT policies (listing).
--    Public URL access still works because the buckets are marked public.
-- ---------------------------------------------------------------------------
drop policy if exists "Avatar images are publicly accessible" on storage.objects;
drop policy if exists "Banner images are publicly accessible" on storage.objects;
drop policy if exists "Sticker images are publicly accessible" on storage.objects;

-- ---------------------------------------------------------------------------
-- 3) SECURITY DEFINER — revoke public / anon execute
--    Keep authenticated only where the client or RLS needs it.
-- ---------------------------------------------------------------------------

-- Trigger-only / internal helpers: nobody via PostgREST
revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

revoke all on function public.stickers_auto_collect() from public;
revoke all on function public.stickers_auto_collect() from anon;
revoke all on function public.stickers_auto_collect() from authenticated;

revoke all on function public.write_group_audit(uuid, text, uuid, jsonb) from public;
revoke all on function public.write_group_audit(uuid, text, uuid, jsonb) from anon;
revoke all on function public.write_group_audit(uuid, text, uuid, jsonb) from authenticated;

-- RLS helpers: authenticated only (policies call these)
revoke all on function public.is_group_member(uuid) from public;
revoke all on function public.is_group_member(uuid) from anon;
grant execute on function public.is_group_member(uuid) to authenticated;

revoke all on function public.is_dm_member(uuid) from public;
revoke all on function public.is_dm_member(uuid) from anon;
grant execute on function public.is_dm_member(uuid) to authenticated;

revoke all on function public.is_group_staff(uuid) from public;
revoke all on function public.is_group_staff(uuid) from anon;
grant execute on function public.is_group_staff(uuid) to authenticated;

revoke all on function public.can_view_channel(uuid) from public;
revoke all on function public.can_view_channel(uuid) from anon;
grant execute on function public.can_view_channel(uuid) to authenticated;

revoke all on function public.are_friends(uuid, uuid) from public;
revoke all on function public.are_friends(uuid, uuid) from anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- Client RPCs: authenticated only (never anon)
revoke all on function public.create_group_with_defaults(text) from public;
revoke all on function public.create_group_with_defaults(text) from anon;
grant execute on function public.create_group_with_defaults(text) to authenticated;

revoke all on function public.join_group_by_invite(text) from public;
revoke all on function public.join_group_by_invite(text) from anon;
grant execute on function public.join_group_by_invite(text) to authenticated;

revoke all on function public.get_or_create_dm(uuid) from public;
revoke all on function public.get_or_create_dm(uuid) from anon;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

revoke all on function public.create_channel(uuid, text, text) from public;
revoke all on function public.create_channel(uuid, text, text) from anon;
grant execute on function public.create_channel(uuid, text, text) to authenticated;

revoke all on function public.delete_channel(uuid) from public;
revoke all on function public.delete_channel(uuid) from anon;
grant execute on function public.delete_channel(uuid) to authenticated;

revoke all on function public.delete_group(uuid) from public;
revoke all on function public.delete_group(uuid) from anon;
grant execute on function public.delete_group(uuid) to authenticated;

revoke all on function public.regenerate_group_invite(uuid) from public;
revoke all on function public.regenerate_group_invite(uuid) from anon;
grant execute on function public.regenerate_group_invite(uuid) to authenticated;

revoke all on function public.set_member_role(uuid, uuid, text) from public;
revoke all on function public.set_member_role(uuid, uuid, text) from anon;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

revoke all on function public.set_channel_private(uuid, boolean) from public;
revoke all on function public.set_channel_private(uuid, boolean) from anon;
grant execute on function public.set_channel_private(uuid, boolean) to authenticated;

revoke all on function public.set_channel_member_access(uuid, uuid, boolean) from public;
revoke all on function public.set_channel_member_access(uuid, uuid, boolean) from anon;
grant execute on function public.set_channel_member_access(uuid, uuid, boolean) to authenticated;

revoke all on function public.send_friend_request(text) from public;
revoke all on function public.send_friend_request(text) from anon;
grant execute on function public.send_friend_request(text) to authenticated;

revoke all on function public.respond_friend_request(uuid, boolean) from public;
revoke all on function public.respond_friend_request(uuid, boolean) from anon;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

revoke all on function public.remove_friend(uuid) from public;
revoke all on function public.remove_friend(uuid) from anon;
grant execute on function public.remove_friend(uuid) to authenticated;

revoke all on function public.save_sticker(uuid) from public;
revoke all on function public.save_sticker(uuid) from anon;
grant execute on function public.save_sticker(uuid) to authenticated;

revoke all on function public.unsave_sticker(uuid) from public;
revoke all on function public.unsave_sticker(uuid) from anon;
grant execute on function public.unsave_sticker(uuid) to authenticated;

revoke all on function public.mark_channel_read(uuid) from public;
revoke all on function public.mark_channel_read(uuid) from anon;
grant execute on function public.mark_channel_read(uuid) to authenticated;

revoke all on function public.mark_dm_read(uuid) from public;
revoke all on function public.mark_dm_read(uuid) from anon;
grant execute on function public.mark_dm_read(uuid) to authenticated;

revoke all on function public.get_unread_summary() from public;
revoke all on function public.get_unread_summary() from anon;
grant execute on function public.get_unread_summary() to authenticated;
