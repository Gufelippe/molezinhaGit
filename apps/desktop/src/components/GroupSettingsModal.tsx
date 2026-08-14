import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Channel, ChannelType, Profile } from "@molezinha/shared";
import { supabase } from "../lib/supabase";
import { MEDIA_LIMITS, validateImageFile } from "../lib/mediaLimits";
import { formatChatTime } from "../lib/datetime";
import { Avatar } from "./Avatar";
import { IconClose, IconHash, IconMegaphone, IconSpeaker } from "./Icons";
import { PromptModal } from "./PromptModal";
import { ImageCropModal } from "./ImageCropModal";
import { NeoCheck, NeoToggle } from "./NeoControls";
import { NeoColorField } from "./NeoColorField";

type MemberRow = {
  user_id: string;
  role: "owner" | "admin" | "member";
  profiles: Profile | null;
};

type AuditRow = {
  id: string;
  action: string;
  created_at: string;
  target_user_id: string | null;
  meta: Record<string, unknown>;
  actor?: Pick<Profile, "display_name" | "username"> | null;
};

type BanRow = {
  user_id: string;
  reason: string | null;
  created_at: string;
  profiles: Pick<Profile, "display_name" | "username" | "avatar_url"> | null;
};

type Section = "members" | "bans" | "branding" | "channels" | "invites" | "audit" | "danger";

export type GroupBrandingPatch = {
  icon_url?: string | null;
  wallpaper_url?: string | null;
  accent_color?: string;
  invite_expires_at?: string | null;
  invite_max_uses?: number | null;
};

interface Props {
  open: boolean;
  groupId: string;
  groupName: string;
  inviteCode: string;
  myRole: "owner" | "admin" | "member";
  channels: Channel[];
  iconUrl?: string | null;
  wallpaperUrl?: string | null;
  accentColor?: string;
  inviteMaxUses?: number | null;
  onClose: () => void;
  onChannelsChanged: () => void;
  onInviteChanged: (code: string) => void;
  onBrandingChanged?: (patch: GroupBrandingPatch) => void;
  onGroupDeleted: () => void;
}

export function GroupSettingsModal({
  open,
  groupId,
  groupName,
  inviteCode,
  myRole,
  channels,
  iconUrl = null,
  wallpaperUrl = null,
  accentColor = "#1f6f5b",
  inviteMaxUses = null,
  onClose,
  onChannelsChanged,
  onInviteChanged,
  onBrandingChanged,
  onGroupDeleted,
}: Props) {
  const [section, setSection] = useState<Section>("members");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [bans, setBans] = useState<BanRow[]>([]);
  const [moderation, setModeration] = useState<{
    userId: string;
    name: string;
    ban: boolean;
  } | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [channelPrompt, setChannelPrompt] = useState<ChannelType | null>(null);
  const [privacyChannel, setPrivacyChannel] = useState<Channel | null>(null);
  const [accessIds, setAccessIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [localInvite, setLocalInvite] = useState(inviteCode);
  const [localIcon, setLocalIcon] = useState<string | null>(iconUrl);
  const [localWallpaper, setLocalWallpaper] = useState<string | null>(wallpaperUrl);
  const [localAccent, setLocalAccent] = useState(accentColor);
  const [maxUses, setMaxUses] = useState(inviteMaxUses ? String(inviteMaxUses) : "");
  const [cropSource, setCropSource] = useState<{
    kind: "groupIcon" | "groupWallpaper";
    file: File;
  } | null>(null);

  const isOwner = myRole === "owner";
  const isStaff = myRole === "owner" || myRole === "admin";

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase
      .from("group_members")
      .select("user_id, role, profiles(*)")
      .eq("group_id", groupId);
    if (error) {
      setStatus(error.message);
      return;
    }
    setMembers(
      (data ?? []).map((row) => {
        const raw = row as unknown as {
          user_id: string;
          role: "owner" | "admin" | "member";
          profiles: Profile | Profile[] | null;
        };
        const p = raw.profiles;
        return {
          user_id: raw.user_id,
          role: raw.role,
          profiles: Array.isArray(p) ? p[0] ?? null : p,
        };
      })
    );
  }, [groupId]);

  const loadBans = useCallback(async () => {
    const { data, error } = await supabase
      .from("group_bans")
      .select("user_id, reason, created_at, profiles:user_id(display_name, username, avatar_url)")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });
    if (error) {
      setStatus(error.message);
      return;
    }
    setBans(
      (data ?? []).map((row) => {
        const raw = row as unknown as {
          user_id: string;
          reason: string | null;
          created_at: string;
          profiles:
            | Pick<Profile, "display_name" | "username" | "avatar_url">
            | Pick<Profile, "display_name" | "username" | "avatar_url">[]
            | null;
        };
        const p = raw.profiles;
        return {
          user_id: raw.user_id,
          reason: raw.reason,
          created_at: raw.created_at,
          profiles: Array.isArray(p) ? p[0] ?? null : p,
        };
      })
    );
  }, [groupId]);

  const loadAudit = useCallback(async () => {
    const { data, error } = await supabase
      .from("group_audit_logs")
      .select("id, action, created_at, target_user_id, meta, actor:actor_id(display_name, username)")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      setStatus(error.message);
      return;
    }
    setAudit(
      (data ?? []).map((row) => {
        const raw = row as unknown as {
          id: string;
          action: string;
          created_at: string;
          target_user_id: string | null;
          meta: Record<string, unknown>;
          actor:
            | Pick<Profile, "display_name" | "username">
            | Pick<Profile, "display_name" | "username">[]
            | null;
        };
        const actor = raw.actor;
        return {
          id: raw.id,
          action: raw.action,
          created_at: raw.created_at,
          target_user_id: raw.target_user_id,
          meta: raw.meta ?? {},
          actor: Array.isArray(actor) ? actor[0] ?? null : actor,
        };
      })
    );
  }, [groupId]);

  const loadChannelAccess = useCallback(async (channelId: string) => {
    const { data, error } = await supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channelId);
    if (error) {
      setStatus(error.message);
      return;
    }
    setAccessIds(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)));
  }, []);

  useEffect(() => {
    setLocalInvite(inviteCode);
  }, [inviteCode]);

  useEffect(() => {
    setLocalIcon(iconUrl);
    setLocalWallpaper(wallpaperUrl);
    setLocalAccent(accentColor);
    setMaxUses(inviteMaxUses ? String(inviteMaxUses) : "");
  }, [iconUrl, wallpaperUrl, accentColor, inviteMaxUses]);

  useEffect(() => {
    if (!open) return;
    void loadMembers();
    if (isStaff) {
      void loadAudit();
      void loadBans();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loadMembers, loadAudit, loadBans, isStaff, onClose]);

  useEffect(() => {
    if (privacyChannel) void loadChannelAccess(privacyChannel.id);
  }, [privacyChannel, loadChannelAccess]);

  if (!open) return null;

  async function setRole(userId: string, role: "admin" | "member") {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("set_member_role", {
      p_group_id: groupId,
      p_user_id: userId,
      p_role: role,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus(role === "admin" ? "Membro promovido a admin." : "Admin removido.");
    await loadMembers();
    await loadAudit();
  }

  function canModerate(targetRole: MemberRow["role"]) {
    if (myRole === "owner") return targetRole !== "owner";
    if (myRole === "admin") return targetRole === "member";
    return false;
  }

  async function moderateMember(userId: string, ban: boolean, reason: string) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("remove_group_member", {
      p_group_id: groupId,
      p_user_id: userId,
      p_ban: ban,
      p_reason: reason || null,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus(ban ? "Membro banido." : "Membro expulso.");
    await loadMembers();
    await loadAudit();
    if (ban) await loadBans();
  }

  async function unbanMember(userId: string) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("unban_group_member", {
      p_group_id: groupId,
      p_user_id: userId,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus("Banimento removido.");
    await loadBans();
    await loadAudit();
  }

  async function createChannel(name: string, type: ChannelType) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("create_channel", {
      p_group_id: groupId,
      p_name: name,
      p_type: type,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus("Canal criado.");
    onChannelsChanged();
    await loadAudit();
  }

  async function removeChannel(channelId: string) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("delete_channel", {
      p_channel_id: channelId,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus("Canal removido.");
    if (privacyChannel?.id === channelId) setPrivacyChannel(null);
    onChannelsChanged();
    await loadAudit();
  }

  async function togglePrivate(channel: Channel, next: boolean) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("set_channel_private", {
      p_channel_id: channel.id,
      p_is_private: next,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus(next ? "Canal agora é privado." : "Canal visível para todos.");
    onChannelsChanged();
    if (privacyChannel?.id === channel.id) {
      setPrivacyChannel({ ...channel, is_private: next });
      if (!next) setAccessIds(new Set());
    }
  }

  async function toggleMemberAccess(userId: string, allow: boolean) {
    if (!privacyChannel) return;
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("set_channel_member_access", {
      p_channel_id: privacyChannel.id,
      p_user_id: userId,
      p_allow: allow,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setAccessIds((prev) => {
      const next = new Set(prev);
      if (allow) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  async function applyBranding(patch: GroupBrandingPatch) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.from("groups").update(patch).eq("id", groupId);
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return false;
    }
    onBrandingChanged?.(patch);
    return true;
  }

  function pickBrandingAsset(file: File, kind: "groupIcon" | "groupWallpaper") {
    if (!file.type.startsWith("image/")) {
      setStatus("Envie uma imagem (PNG, JPG, WEBP ou GIF).");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setStatus("Imagem muito grande (máx. 25MB).");
      return;
    }
    setStatus(null);
    setCropSource({ kind, file });
  }

  async function uploadBrandingAsset(file: File, kind: "groupIcon" | "groupWallpaper") {
    const check = await validateImageFile(file, kind);
    if (!check.ok) {
      setStatus(check.message);
      return;
    }
    setBusy(true);
    setStatus(null);
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const slot = kind === "groupIcon" ? "icon" : "wallpaper";
    const path = `${groupId}/${slot}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("group-assets")
      .upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) {
      setBusy(false);
      setStatus(upErr.message);
      return;
    }
    const { data: pub } = supabase.storage.from("group-assets").getPublicUrl(path);
    setBusy(false);
    const url = pub.publicUrl;
    const ok = await applyBranding(
      kind === "groupIcon" ? { icon_url: url } : { wallpaper_url: url }
    );
    if (!ok) return;
    if (kind === "groupIcon") setLocalIcon(url);
    else setLocalWallpaper(url);
    setStatus("Identidade visual atualizada.");
  }

  async function saveInviteLimits() {
    const trimmed = maxUses.trim();
    const parsed = trimmed ? Number(trimmed) : null;
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) {
      setStatus("Use um número inteiro maior que zero (ou deixe vazio).");
      return;
    }
    const ok = await applyBranding({ invite_max_uses: parsed });
    if (ok) setStatus(parsed ? `Convite limitado a ${parsed} usos.` : "Convite sem limite de usos.");
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(localInvite);
      setStatus("Código copiado.");
    } catch {
      setStatus("Não foi possível copiar.");
    }
  }

  async function regenerateInvite() {
    setBusy(true);
    setStatus(null);
    const { data, error } = await supabase.rpc("regenerate_group_invite", {
      p_group_id: groupId,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    const code = String(data ?? "");
    setLocalInvite(code);
    onInviteChanged(code);
    setStatus("Novo código gerado.");
    await loadAudit();
  }

  async function deleteGroup() {
    if (deleteConfirm.trim() !== groupName) {
      setStatus("Digite o nome exato do servidor para confirmar.");
      return;
    }
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("delete_group", {
      p_group_id: groupId,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    onGroupDeleted();
    onClose();
  }

  function formatAction(row: AuditRow) {
    const actor = row.actor?.display_name ?? "Alguém";
    if (row.action === "role_changed") {
      return `${actor} alterou cargo → ${String(row.meta?.role ?? "")}`;
    }
    if (row.action === "channel_created") {
      return `${actor} criou #${String(row.meta?.name ?? "")} (${String(row.meta?.type ?? "")})`;
    }
    if (row.action === "channel_deleted") {
      return `${actor} removeu #${String(row.meta?.name ?? "")}`;
    }
    if (row.action === "channel_privacy") {
      return `${actor} ${row.meta?.is_private ? "privou" : "publicou"} canal`;
    }
    if (row.action === "invite_regenerated") {
      return `${actor} regenerou o convite`;
    }
    if (row.action === "kicked") {
      const reason = row.meta?.reason ? ` — ${String(row.meta.reason)}` : "";
      return `${actor} expulsou um membro${reason}`;
    }
    if (row.action === "banned") {
      const reason = row.meta?.reason ? ` — ${String(row.meta.reason)}` : "";
      return `${actor} baniu um membro${reason}`;
    }
    if (row.action === "unbanned") {
      return `${actor} removeu um banimento`;
    }
    return `${actor}: ${row.action}`;
  }

  const liveChannel =
    privacyChannel &&
    (channels.find((c) => c.id === privacyChannel.id) ?? privacyChannel);

  return (
    <>
      <div className="settings-overlay">
        <aside className="settings-aside">
          <div className="brand panel-brand panel-brand-tight">
            {groupName}
          </div>
          <p className="muted panel-brand-sub">
            Configurações do servidor
          </p>
          <nav className="settings-nav">
            <button type="button" className={section === "members" ? "active" : ""} onClick={() => setSection("members")}>
              Membros
            </button>
            {isStaff && (
              <button type="button" className={section === "bans" ? "active" : ""} onClick={() => setSection("bans")}>
                Banidos
              </button>
            )}
            {isStaff && (
              <button type="button" className={section === "branding" ? "active" : ""} onClick={() => setSection("branding")}>
                Identidade
              </button>
            )}
            {isStaff && (
              <button type="button" className={section === "channels" ? "active" : ""} onClick={() => setSection("channels")}>
                Canais
              </button>
            )}
            {isStaff && (
              <button type="button" className={section === "invites" ? "active" : ""} onClick={() => setSection("invites")}>
                Convites
              </button>
            )}
            {isStaff && (
              <button type="button" className={section === "audit" ? "active" : ""} onClick={() => setSection("audit")}>
                Auditoria
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                className={`settings-nav-danger ${section === "danger" ? "active" : ""}`}
                onClick={() => setSection("danger")}
              >
                Excluir servidor
              </button>
            )}
          </nav>
        </aside>

        <section className="settings-main">
          <div className="settings-top">
            <h2>
              {section === "members" && "Membros"}
              {section === "bans" && "Banidos"}
              {section === "branding" && "Identidade"}
              {section === "channels" && "Canais"}
              {section === "invites" && "Convites"}
              {section === "audit" && "Auditoria"}
              {section === "danger" && "Excluir servidor"}
            </h2>
            <button className="neo-btn neo-btn-icon" type="button" onClick={onClose} aria-label="Fechar">
              <IconClose />
            </button>
          </div>

          {status && <p className="muted status-note">{status}</p>}

          {section === "members" && (
            <div className="settings-section">
              {members.map((m) => (
                <div key={m.user_id} className="user-panel person-row">
                  <Avatar
                    size="sm"
                    name={m.profiles?.display_name ?? "?"}
                    url={m.profiles?.avatar_url}
                    id={m.user_id}
                  />
                  <div className="user-panel-identity">
                    <span className="user-panel-name">{m.profiles?.display_name ?? "Usuário"}</span>
                    <span className="user-panel-handle muted">@{m.profiles?.username}</span>
                  </div>
                  <span className={`role-badge ${m.role}`}>{m.role}</span>
                  <div className="member-mod-actions">
                    {isOwner && m.role === "member" && (
                      <button className="neo-btn neo-btn-compact" type="button" disabled={busy} onClick={() => void setRole(m.user_id, "admin")}>
                        Tornar admin
                      </button>
                    )}
                    {isOwner && m.role === "admin" && (
                      <button className="neo-btn neo-btn-compact neo-btn-danger" type="button" disabled={busy} onClick={() => void setRole(m.user_id, "member")}>
                        Remover admin
                      </button>
                    )}
                    {isStaff && canModerate(m.role) && (
                      <>
                        <button
                          className="neo-btn neo-btn-compact"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setModeration({
                              userId: m.user_id,
                              name: m.profiles?.display_name ?? "membro",
                              ban: false,
                            })
                          }
                        >
                          Expulsar
                        </button>
                        <button
                          className="neo-btn neo-btn-compact neo-btn-danger"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setModeration({
                              userId: m.user_id,
                              name: m.profiles?.display_name ?? "membro",
                              ban: true,
                            })
                          }
                        >
                          Banir
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {section === "bans" && isStaff && (
            <div className="settings-section">
              {bans.length === 0 && (
                <p className="muted">Ninguém está banido neste servidor.</p>
              )}
              {bans.map((b) => (
                <div key={b.user_id} className="user-panel person-row">
                  <Avatar
                    size="sm"
                    name={b.profiles?.display_name ?? "?"}
                    url={b.profiles?.avatar_url}
                    id={b.user_id}
                  />
                  <div className="user-panel-identity">
                    <span className="user-panel-name">{b.profiles?.display_name ?? "Usuário"}</span>
                    <span className="user-panel-handle muted">
                      {b.reason ? b.reason : `@${b.profiles?.username ?? ""}`}
                    </span>
                  </div>
                  <button
                    className="neo-btn neo-btn-compact"
                    type="button"
                    disabled={busy}
                    onClick={() => void unbanMember(b.user_id)}
                  >
                    Desbanir
                  </button>
                </div>
              ))}
            </div>
          )}

          {section === "branding" && isStaff && (
            <div
              className="settings-section settings-section-wide branding-section"
              style={{ ["--preview-accent" as string]: localAccent } as CSSProperties}
            >
              <p className="muted profile-intro">
                Ícone, papel de parede e cor de destaque aparecem para todo mundo no grupo.
              </p>

              <div className="branding-grid">
                <section className="branding-card">
                  <div className="branding-card-head">
                    <span className="branding-card-title">Ícone do grupo</span>
                    <span className="branding-card-hint">PNG, JPEG, WebP ou GIF · até 1,5 MB</span>
                  </div>
                  <div className="branding-card-body">
                    <div className="branding-preview branding-preview-icon">
                      {localIcon ? (
                        <img src={localIcon} alt="" />
                      ) : (
                        <span>{groupName.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="branding-actions">
                      <label className="neo-btn neo-btn-compact neo-btn-file">
                        {localIcon ? "Trocar" : "Enviar ícone"}
                        <input
                          type="file"
                          hidden
                          accept={MEDIA_LIMITS.groupIcon.accept}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) pickBrandingAsset(file, "groupIcon");
                          }}
                        />
                      </label>
                      {localIcon && (
                        <button
                          type="button"
                          className="neo-btn neo-btn-compact neo-btn-danger"
                          disabled={busy}
                          onClick={() => {
                            void applyBranding({ icon_url: null }).then((ok) => {
                              if (ok) setLocalIcon(null);
                            });
                          }}
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  </div>
                </section>

                <section className="branding-card">
                  <div className="branding-card-head">
                    <span className="branding-card-title">Papel de parede</span>
                    <span className="branding-card-hint">Até 3 MB · no máximo 2560px de lado</span>
                  </div>
                  <div className="branding-card-body">
                    <div className="branding-preview branding-preview-wallpaper">
                      {localWallpaper ? (
                        <>
                          <img src={localWallpaper} alt="" />
                          <span className="wallpaper-mock" aria-hidden>
                            <span className="wallpaper-mock-bubble" />
                            <span className="wallpaper-mock-bubble wallpaper-mock-bubble-own" />
                          </span>
                        </>
                      ) : (
                        <span className="branding-preview-empty">sem imagem</span>
                      )}
                    </div>
                    <div className="branding-actions">
                      <label className="neo-btn neo-btn-compact neo-btn-file">
                        {localWallpaper ? "Trocar" : "Enviar imagem"}
                        <input
                          type="file"
                          hidden
                          accept={MEDIA_LIMITS.groupWallpaper.accept}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) pickBrandingAsset(file, "groupWallpaper");
                          }}
                        />
                      </label>
                      {localWallpaper && (
                        <button
                          type="button"
                          className="neo-btn neo-btn-compact neo-btn-danger"
                          disabled={busy}
                          onClick={() => {
                            void applyBranding({ wallpaper_url: null }).then((ok) => {
                              if (ok) setLocalWallpaper(null);
                            });
                          }}
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              <section className="branding-card branding-card-accent">
                <div className="branding-card-head">
                  <span className="branding-card-title">Cor de destaque</span>
                  <span className="branding-card-hint">
                    Tinge canal ativo, menções e o botão de enviar.
                  </span>
                </div>
                <div className="branding-accent-row">
                  <NeoColorField
                    value={localAccent}
                    aria-label="Cor de destaque"
                    onChange={(hex) => setLocalAccent(hex)}
                  />
                  <button
                    className="neo-btn neo-btn-compact neo-btn-primary"
                    type="button"
                    disabled={busy || localAccent === accentColor}
                    onClick={() => {
                      void applyBranding({ accent_color: localAccent }).then((ok) => {
                        if (ok) setStatus("Cor de destaque salva.");
                      });
                    }}
                  >
                    {localAccent === accentColor ? "Cor salva" : "Salvar cor"}
                  </button>
                </div>
                <div className="accent-preview" aria-hidden>
                  <span className="accent-preview-channel">
                    <span className="accent-preview-marker" />
                    <IconHash />
                    geral
                  </span>
                  <span className="accent-preview-badge">3</span>
                  <span className="accent-preview-send">Enviar</span>
                </div>
              </section>
            </div>
          )}

          {section === "channels" && isStaff && (
            <div className="settings-section settings-section-wide settings-section-tight">
              <div className="stack-row stack-row-below">
                <button className="neo-btn neo-btn-primary" type="button" onClick={() => setChannelPrompt("text")}>
                  <IconHash /> Novo texto
                </button>
                <button className="neo-btn" type="button" onClick={() => setChannelPrompt("voice")}>
                  <IconSpeaker /> Novo voz
                </button>
                <button className="neo-btn" type="button" onClick={() => setChannelPrompt("announcement")}>
                  <IconMegaphone /> Novo avisos
                </button>
              </div>
              {channels.length === 0 && (
                <p className="muted">Nenhum canal. Crie um texto ou voz acima.</p>
              )}
              {channels.map((c) => (
                <div key={c.id} className="channel-admin-block">
                  <div className="channel-admin-row">
                    {c.type === "voice" ? (
                      <IconSpeaker />
                    ) : c.type === "announcement" ? (
                      <IconMegaphone />
                    ) : (
                      <IconHash />
                    )}
                    <div className="name">#{c.name}</div>
                    <span className="role-badge">
                      {c.type === "voice" ? "voz" : c.type === "announcement" ? "avisos" : "texto"}
                    </span>
                    {c.is_private && <span className="role-badge">privado</span>}
                    <button
                      className="neo-btn neo-btn-compact"
                      type="button"
                      onClick={() => setPrivacyChannel(privacyChannel?.id === c.id ? null : c)}
                    >
                      Acesso
                    </button>
                    <button
                      className="neo-btn neo-btn-danger neo-btn-compact"
                      type="button"
                      disabled={busy}
                      onClick={() => void removeChannel(c.id)}
                    >
                      Remover
                    </button>
                  </div>
                  {liveChannel?.id === c.id && (
                    <div className="channel-privacy-panel">
                      <NeoToggle
                        checked={!!liveChannel.is_private}
                        disabled={busy}
                        onChange={(v) => void togglePrivate(c, v)}
                        label={
                          <span>
                            <strong>Canal privado</strong>
                            <span className="muted check-sublabel">
                              Só membros e staff selecionados enxergam este canal.
                            </span>
                          </span>
                        }
                      />
                      {liveChannel.is_private && (
                        <div className="channel-access-list">
                          <p className="muted field-note field-note-flush">
                            Quem pode acessar (além de owner/admins):
                          </p>
                          {members
                            .filter((m) => m.role === "member")
                            .map((m) => {
                              const allowed = accessIds.has(m.user_id);
                              return (
                                <div key={m.user_id} className="channel-access-item">
                                  <NeoCheck
                                    checked={allowed}
                                    disabled={busy}
                                    onChange={(v) => void toggleMemberAccess(m.user_id, v)}
                                    label={m.profiles?.display_name ?? "Membro"}
                                  />
                                </div>
                              );
                            })}
                          {members.filter((m) => m.role === "member").length === 0 && (
                            <p className="muted field-note field-note-flush">
                              Só há staff no servidor — todos já veem canais privados.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {section === "invites" && isStaff && (
            <div className="settings-section">
              <p className="muted">Compartilhe o código para amigos entrarem no servidor.</p>
              <div className="invite-manage neo-inset">
                <code>{localInvite}</code>
              </div>
              <div className="stack-row stack-row-spaced">
                <button className="neo-btn neo-btn-primary" type="button" disabled={busy} onClick={() => void copyInvite()}>
                  Copiar código
                </button>
                <button className="neo-btn" type="button" disabled={busy} onClick={() => void regenerateInvite()}>
                  Regenerar
                </button>
              </div>
              <p className="muted field-note">
                Regenerar invalida o código antigo imediatamente.
              </p>

              <div className="field field-spaced">
                <label htmlFor="invite-max-uses">Limite de usos (opcional)</label>
                <input
                  id="invite-max-uses"
                  className="neo-input"
                  inputMode="numeric"
                  value={maxUses}
                  placeholder="deixe vazio para ilimitado"
                  onChange={(e) => setMaxUses(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </div>
              <button
                className="neo-btn neo-btn-primary"
                type="button"
                disabled={busy}
                onClick={() => void saveInviteLimits()}
              >
                Salvar limite
              </button>
            </div>
          )}

          {section === "audit" && isStaff && (
            <div className="settings-section settings-section-wide">
              {audit.length === 0 && <p className="muted">Nenhum evento ainda.</p>}
              {audit.map((row) => (
                <div key={row.id} className="audit-row">
                  <div className="audit-row-title">{formatAction(row)}</div>
                  <div className="muted audit-row-time">{formatChatTime(row.created_at)}</div>
                </div>
              ))}
            </div>
          )}

          {section === "danger" && isOwner && (
            <div className="settings-section">
              <p className="danger-copy">
                Isso apaga o servidor, canais e mensagens permanentemente.
              </p>
              <p className="muted">
                Digite <strong>{groupName}</strong> para confirmar.
              </p>
              <div className="field">
                <label htmlFor="delete-server-name">Nome do servidor</label>
                <input
                  id="delete-server-name"
                  className="neo-input"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder={groupName}
                  autoComplete="off"
                />
              </div>
              <button
                className="neo-btn neo-btn-danger"
                type="button"
                disabled={busy || deleteConfirm.trim() !== groupName}
                onClick={() => void deleteGroup()}
              >
                Excluir servidor
              </button>
            </div>
          )}
        </section>
      </div>

      <PromptModal
        open={Boolean(moderation)}
        title={moderation?.ban ? `Banir ${moderation.name}?` : `Expulsar ${moderation?.name}?`}
        label="Motivo (opcional)"
        placeholder="ex: flood no chat"
        confirmLabel={moderation?.ban ? "Banir" : "Expulsar"}
        allowEmpty
        danger={Boolean(moderation?.ban)}
        onClose={() => setModeration(null)}
        onConfirm={(reason) => {
          if (!moderation) return;
          const { userId, ban } = moderation;
          setModeration(null);
          void moderateMember(userId, ban, reason);
        }}
      />
      <PromptModal
        open={channelPrompt === "text"}
        title="Novo canal de texto"
        label="Nome do canal"
        placeholder="ex: avisos"
        confirmLabel="Criar"
        onClose={() => setChannelPrompt(null)}
        onConfirm={(name) => void createChannel(name, "text")}
      />
      <PromptModal
        open={channelPrompt === "voice"}
        title="Novo canal de voz"
        label="Nome do canal"
        placeholder="ex: call-geral"
        confirmLabel="Criar"
        onClose={() => setChannelPrompt(null)}
        onConfirm={(name) => void createChannel(name, "voice")}
      />
      <PromptModal
        open={channelPrompt === "announcement"}
        title="Novo canal de avisos"
        label="Nome do canal"
        placeholder="ex: comunicados"
        confirmLabel="Criar"
        onClose={() => setChannelPrompt(null)}
        onConfirm={(name) => void createChannel(name, "announcement")}
      />
      <ImageCropModal
        open={!!cropSource}
        file={cropSource?.file ?? null}
        kind={cropSource?.kind ?? "groupIcon"}
        onCancel={() => setCropSource(null)}
        onConfirm={(file) => {
          const kind = cropSource?.kind ?? "groupIcon";
          setCropSource(null);
          void uploadBrandingAsset(file, kind);
        }}
      />
    </>
  );
}
