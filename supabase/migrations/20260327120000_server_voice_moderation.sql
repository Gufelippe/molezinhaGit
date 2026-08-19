-- Server mute / deafen for voice. Staff-only; never self-moderate.

alter table public.group_members
  add column if not exists server_muted boolean not null default false,
  add column if not exists server_deafened boolean not null default false;

create or replace function public.set_group_voice_moderation(
  p_group_id uuid,
  p_user_id uuid,
  p_muted boolean,
  p_deafened boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target_role text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Você não pode se moderar';
  end if;

  select role into actor_role
  from public.group_members
  where group_id = p_group_id and user_id = auth.uid();

  if actor_role is null or public.member_role_rank(actor_role) < 2 then
    raise exception 'Sem permissão';
  end if;

  select role into target_role
  from public.group_members
  where group_id = p_group_id and user_id = p_user_id;

  if target_role is null then
    raise exception 'Membro não encontrado';
  end if;

  if public.member_role_rank(actor_role) <= public.member_role_rank(target_role) then
    raise exception 'Você não pode moderar este membro';
  end if;

  update public.group_members
  set
    server_muted = p_muted,
    server_deafened = p_deafened
  where group_id = p_group_id and user_id = p_user_id;

  perform public.write_group_audit(
    p_group_id,
    case
      when p_deafened then 'voice_deafened'
      when p_muted then 'voice_muted'
      else 'voice_unmuted'
    end,
    p_user_id,
    jsonb_build_object('muted', p_muted, 'deafened', p_deafened)
  );
end;
$$;

revoke all on function public.set_group_voice_moderation(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.set_group_voice_moderation(uuid, uuid, boolean, boolean) to authenticated;
