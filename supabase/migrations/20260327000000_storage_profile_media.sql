-- Avatar / banner uploads were failing with "new row violates row-level security policy".
-- Rebuilds both buckets and their policies from scratch so a project that missed (or
-- partially applied) the earlier migrations ends up in a known-good state.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do update set public = true;

-- ---------------------------------------------------------------------------
-- Drop every policy these buckets ever had, including the non-idempotent ones
-- from the initial migration.
-- ---------------------------------------------------------------------------
drop policy if exists "Avatar images are publicly accessible" on storage.objects;
drop policy if exists "Users can upload own avatar" on storage.objects;
drop policy if exists "Users can update own avatar" on storage.objects;
drop policy if exists "Users can delete own avatar" on storage.objects;

drop policy if exists "Banner images are publicly accessible" on storage.objects;
drop policy if exists "Users can upload own banner" on storage.objects;
drop policy if exists "Users can update own banner" on storage.objects;
drop policy if exists "Users can delete own banner" on storage.objects;

drop policy if exists "Profile media readable by owner" on storage.objects;
drop policy if exists "Profile media insert own folder" on storage.objects;
drop policy if exists "Profile media update own folder" on storage.objects;
drop policy if exists "Profile media delete own folder" on storage.objects;

-- ---------------------------------------------------------------------------
-- One policy set for both buckets. Files live under <user-id>/<file>, so the
-- first path segment is the owner.
--
-- SELECT stays scoped to the owner (public reads keep working through the
-- public bucket URL, so this does not re-open bucket listing to everyone).
-- The client needs it to list and clean up its own old uploads.
-- ---------------------------------------------------------------------------
create policy "Profile media readable by owner"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('avatars', 'banners')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Profile media insert own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('avatars', 'banners')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Profile media update own folder"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('avatars', 'banners')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('avatars', 'banners')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Profile media delete own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('avatars', 'banners')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
