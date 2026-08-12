-- Profile customization: banner, accent, pronouns, custom status + banners storage

alter table public.profiles
  add column if not exists banner_url text,
  add column if not exists banner_color text not null default '#3d6b5a',
  add column if not exists accent_color text not null default '#7eb89f',
  add column if not exists pronouns text,
  add column if not exists custom_status text;

alter table public.profiles
  drop constraint if exists profiles_banner_color_hex;
alter table public.profiles
  add constraint profiles_banner_color_hex
  check (banner_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.profiles
  drop constraint if exists profiles_accent_color_hex;
alter table public.profiles
  add constraint profiles_accent_color_hex
  check (accent_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.profiles
  drop constraint if exists profiles_pronouns_len;
alter table public.profiles
  add constraint profiles_pronouns_len
  check (pronouns is null or char_length(pronouns) <= 40);

alter table public.profiles
  drop constraint if exists profiles_custom_status_len;
alter table public.profiles
  add constraint profiles_custom_status_len
  check (custom_status is null or char_length(custom_status) <= 128);

-- Storage for banners
insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

drop policy if exists "Banner images are publicly accessible" on storage.objects;
create policy "Banner images are publicly accessible"
  on storage.objects for select using (bucket_id = 'banners');

drop policy if exists "Users can upload own banner" on storage.objects;
create policy "Users can upload own banner"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own banner" on storage.objects;
create policy "Users can update own banner"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own banner" on storage.objects;
create policy "Users can delete own banner"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
