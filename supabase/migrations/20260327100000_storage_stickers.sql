-- Sticker uploads were failing the same way avatars/banners did: missing bucket
-- or RLS on storage.objects. Rebuild the stickers bucket policies idempotently.

insert into storage.buckets (id, name, public)
values ('stickers', 'stickers', true)
on conflict (id) do update set public = true;

drop policy if exists "Sticker images are publicly accessible" on storage.objects;
drop policy if exists "Users can upload own stickers" on storage.objects;
drop policy if exists "Users can update own stickers" on storage.objects;
drop policy if exists "Users can delete own stickers" on storage.objects;
drop policy if exists "Sticker media readable by owner" on storage.objects;
drop policy if exists "Sticker media insert own folder" on storage.objects;
drop policy if exists "Sticker media update own folder" on storage.objects;
drop policy if exists "Sticker media delete own folder" on storage.objects;

create policy "Sticker media readable by owner"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'stickers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Sticker media insert own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'stickers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Sticker media update own folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'stickers'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'stickers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Sticker media delete own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'stickers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
