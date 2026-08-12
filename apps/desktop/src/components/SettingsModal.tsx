import { useEffect, useMemo, useRef, useState } from "react";
import type { Profile, PublicProfilePatch, ThemePreference, ThemeSettings } from "@molezinha/shared";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { socialClient } from "../lib/social";
import {
  THEME_COLOR_KEYS,
  THEME_FONTS,
  THEME_PRESETS,
  DARK_DEFAULTS,
  LIGHT_DEFAULTS,
  baseAppearance,
  hasThemeOverrides,
  keepCustomAppearance,
  restoreCustomAppearance,
} from "../lib/theme";
import { MEDIA_LIMITS, validateImageFile } from "../lib/mediaLimits";
import { ImageCropModal } from "./ImageCropModal";
import {
  IconBell,
  IconClose,
  IconKey,
  IconMic,
  IconPalette,
  IconSettings,
  IconUser,
  IconVideo,
} from "./Icons";
import { NeoSelect } from "./NeoSelect";
import { NeoToggle, NeoRange } from "./NeoControls";
import { NeoColorField } from "./NeoColorField";
import { HotkeyRecorder } from "./HotkeyRecorder";
import { ProfileCard } from "./ProfileCard";
import {
  applyAudioOutput,
  buildAudioConstraints,
  readVoiceSettings,
  writeVoiceSettings,
  VIDEO_QUALITY_OPTIONS,
  type VideoQuality,
  type VoiceSettings,
} from "../lib/voiceSettings";
import {
  ensureNotificationPermission,
  readNotifyPrefs,
  writeNotifyPrefs,
  type NotifyPrefs,
} from "../lib/notifications";
import {
  checkForAppUpdate,
  DEFAULT_HOTKEYS,
  isTauri,
  readHotkeys,
  writeHotkeys,
  type Hotkeys,
} from "../lib/desktopNative";
import {
  readActivityDetectEnabled,
  writeActivityDetectEnabled,
} from "../lib/activity";

type Section = "account" | "profile" | "appearance" | "voice" | "notifications";

function timeInputValue(v?: string | null): string {
  if (!v) return "";
  return v.slice(0, 5);
}

const DEFAULT_BANNER = "#3d6b5a";
const DEFAULT_ACCENT = "#7eb89f";

interface Props {
  open: boolean;
  onClose: () => void;
  initialSection?: Section;
}

function toPublicPatch(p: Profile): PublicProfilePatch {
  return {
    id: p.id,
    username: p.username,
    display_name: p.display_name,
    avatar_url: p.avatar_url,
    bio: p.bio,
    banner_url: p.banner_url ?? null,
    banner_color: p.banner_color ?? DEFAULT_BANNER,
    accent_color: p.accent_color ?? DEFAULT_ACCENT,
    pronouns: p.pronouns ?? null,
    custom_status: p.custom_status ?? null,
    status: p.status,
    activity: p.activity ?? null,
  };
}

function storagePathFromPublicUrl(bucket: "avatars" | "banners", url: string | null | undefined) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(url.slice(idx + marker.length).split("?")[0] ?? "");
  } catch {
    return url.slice(idx + marker.length).split("?")[0] ?? null;
  }
}

/** Remove every file in the user's folder for this bucket (cleans orphans from old uploads). */
async function clearUserStorageFolder(bucket: "avatars" | "banners", userId: string) {
  const { data, error } = await supabase.storage.from(bucket).list(userId, { limit: 100 });
  if (error || !data?.length) return;
  const paths = data
    .filter((f) => f.name && f.name !== ".emptyFolderPlaceholder")
    .map((f) => `${userId}/${f.name}`);
  if (paths.length) {
    await supabase.storage.from(bucket).remove(paths);
  }
}

async function removeStoredImage(bucket: "avatars" | "banners", url: string | null | undefined) {
  const path = storagePathFromPublicUrl(bucket, url);
  if (path) {
    await supabase.storage.from(bucket).remove([path]);
  }
}

async function uploadImage(bucket: "avatars" | "banners", userId: string, file: File) {
  const kind = bucket === "avatars" ? "avatar" : "banner";
  const check = await validateImageFile(file, kind);
  if (!check.ok) throw new Error(check.message);
  // Wipe previous uploads for this user so Storage doesn't keep dead files
  await clearUserStorageFolder(bucket, userId);
  const path = `${userId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) {
    // Storage answers RLS failures with a bare Postgres message — translate it.
    if (/row-level security|violates|not authorized/i.test(error.message)) {
      throw new Error(
        `O Storage recusou o upload de ${kind === "avatar" ? "avatar" : "banner"}. Rode a migration mais recente de storage no Supabase.`
      );
    }
    throw new Error(error.message);
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** The cropper re-encodes everything, so the source only needs a sanity cap. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

function validateSource(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Envie uma imagem (PNG, JPG, WEBP ou GIF).";
  if (file.size > MAX_SOURCE_BYTES) return "Imagem muito grande (máx. 25MB).";
  return null;
}

function validateImage(file: File, kind: "avatar" | "banner" = "avatar"): string | null {
  if (!MEDIA_LIMITS[kind].accept.split(",").includes(file.type) && !file.type.startsWith("image/")) {
    return "Envie uma imagem (PNG, JPG, WEBP ou GIF).";
  }
  if (file.size > MEDIA_LIMITS[kind].maxBytes) {
    return `Imagem muito grande (máx. ${(MEDIA_LIMITS[kind].maxBytes / (1024 * 1024)).toFixed(1)}MB).`;
  }
  return null;
}

export function SettingsModal({ open, onClose, initialSection = "account" }: Props) {
  const {
    user,
    profile,
    updateProfile,
    theme,
    themeSettings,
    setThemeSettings,
    setAppearance,
    signOut,
    resolvedTheme,
  } = useAuth();
  const overridesActive = hasThemeOverrides(themeSettings);
  const savedCustom = hasThemeOverrides(themeSettings.saved) ? themeSettings.saved : undefined;
  /** Any manual tweak becomes the active custom look, so a parked copy would be stale. */
  const patchCustomTheme = (patch: ThemeSettings) => {
    void setThemeSettings({ ...themeSettings, presetId: null, saved: undefined, ...patch });
  };
  const [section, setSection] = useState<Section>(initialSection);
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [pronouns, setPronouns] = useState(profile?.pronouns ?? "");
  const [customStatus, setCustomStatus] = useState(profile?.custom_status ?? "");
  const [bannerColor, setBannerColor] = useState(profile?.banner_color ?? DEFAULT_BANNER);
  const [accentColor, setAccentColor] = useState(profile?.accent_color ?? DEFAULT_ACCENT);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState(localStorage.getItem("molezinha.mic") ?? "");
  const [camId, setCamId] = useState(localStorage.getItem("molezinha.cam") ?? "");
  const [voicePrefs, setVoicePrefs] = useState<VoiceSettings>(() => readVoiceSettings());
  const [hotkeys, setHotkeys] = useState<Hotkeys>(() => readHotkeys());
  const [activityDetect, setActivityDetect] = useState(() => readActivityDetectEnabled());
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs>(() => readNotifyPrefs());
  const [micLevel, setMicLevel] = useState(0);
  const [micTesting, setMicTesting] = useState(false);
  const micTestCleanupRef = useRef<(() => void) | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [pendingAvatarPreview, setPendingAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [pendingBanner, setPendingBanner] = useState<File | null>(null);
  const [pendingBannerPreview, setPendingBannerPreview] = useState<string | null>(null);
  const [removeBanner, setRemoveBanner] = useState(false);
  const [cropSource, setCropSource] = useState<{ kind: "avatar" | "banner"; file: File } | null>(
    null
  );
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  function hydrateFromProfile() {
    setDisplayName(profile?.display_name ?? "");
    setBio(profile?.bio ?? "");
    setPronouns(profile?.pronouns ?? "");
    setCustomStatus(profile?.custom_status ?? "");
    setBannerColor(profile?.banner_color ?? DEFAULT_BANNER);
    setAccentColor(profile?.accent_color ?? DEFAULT_ACCENT);
    setPendingAvatar(null);
    setRemoveAvatar(false);
    setPendingBanner(null);
    setRemoveBanner(false);
    setPendingAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPendingBannerPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setStatus(null);
  }

  useEffect(() => {
    if (!open) return;
    setSection(initialSection);
    hydrateFromProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open / section entry
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || section !== "voice") return;
    let cancelled = false;
    void (async () => {
      try {
        // Unlock device labels (incl. speakers) after a short permission grant
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore — still list what we can */
      }
      if (cancelled) return;
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      if (!cancelled) setDevices(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, section]);

  useEffect(() => {
    return () => {
      if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
    };
  }, [pendingAvatarPreview]);

  useEffect(() => {
    return () => {
      if (pendingBannerPreview) URL.revokeObjectURL(pendingBannerPreview);
    };
  }, [pendingBannerPreview]);

  const mics = useMemo(
    () => devices.filter((d) => d.kind === "audioinput"),
    [devices]
  );
  const speakers = useMemo(
    () => devices.filter((d) => d.kind === "audiooutput"),
    [devices]
  );
  const cams = useMemo(
    () => devices.filter((d) => d.kind === "videoinput"),
    [devices]
  );

  const previewAvatarUrl = removeAvatar
    ? null
    : pendingAvatarPreview ?? profile?.avatar_url ?? null;

  const previewBannerUrl = removeBanner
    ? null
    : pendingBannerPreview ?? profile?.banner_url ?? null;

  const profileDirty =
    displayName.trim() !== (profile?.display_name ?? "") ||
    (bio ?? "") !== (profile?.bio ?? "") ||
    (pronouns ?? "") !== (profile?.pronouns ?? "") ||
    (customStatus ?? "") !== (profile?.custom_status ?? "") ||
    bannerColor.toLowerCase() !== (profile?.banner_color ?? DEFAULT_BANNER).toLowerCase() ||
    accentColor.toLowerCase() !== (profile?.accent_color ?? DEFAULT_ACCENT).toLowerCase() ||
    pendingAvatar !== null ||
    removeAvatar ||
    pendingBanner !== null ||
    removeBanner;

  useEffect(() => {
    if (!open || section !== "voice") {
      micTestCleanupRef.current?.();
      micTestCleanupRef.current = null;
      setMicTesting(false);
      setMicLevel(0);
    }
  }, [open, section]);

  useEffect(() => {
    return () => {
      micTestCleanupRef.current?.();
    };
  }, []);

  if (!open) return null;

  function openCropper(kind: "avatar" | "banner", file: File) {
    const err = validateSource(file);
    setStatus(err);
    if (err) return;
    setCropSource({ kind, file });
  }

  function stageAvatar(file: File) {
    setStatus(null);
    const err = validateImage(file, "avatar");
    if (err) {
      setStatus(err);
      return;
    }
    setPendingAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setPendingAvatar(file);
    setRemoveAvatar(false);
  }

  function stageBanner(file: File) {
    setStatus(null);
    const err = validateImage(file, "banner");
    if (err) {
      setStatus(err);
      return;
    }
    setPendingBannerPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setPendingBanner(file);
    setRemoveBanner(false);
  }

  async function saveProfile() {
    if (!user || !profileDirty) return;
    setSaving(true);
    setStatus(null);
    try {
      const patch: Partial<Profile> = {
        display_name: displayName.trim() || profile?.display_name || "Usuário",
        bio: bio.trim() || null,
        pronouns: pronouns.trim() || null,
        custom_status: customStatus.trim() || null,
        banner_color: /^#[0-9A-Fa-f]{6}$/.test(bannerColor) ? bannerColor : DEFAULT_BANNER,
        accent_color: /^#[0-9A-Fa-f]{6}$/.test(accentColor) ? accentColor : DEFAULT_ACCENT,
      };

      if (removeAvatar) {
        await clearUserStorageFolder("avatars", user.id);
        await removeStoredImage("avatars", profile?.avatar_url);
        patch.avatar_url = null;
      } else if (pendingAvatar) {
        patch.avatar_url = await uploadImage("avatars", user.id, pendingAvatar);
      }

      if (removeBanner) {
        await clearUserStorageFolder("banners", user.id);
        await removeStoredImage("banners", profile?.banner_url);
        patch.banner_url = null;
      } else if (pendingBanner) {
        patch.banner_url = await uploadImage("banners", user.id, pendingBanner);
      }

      const saved = await updateProfile(patch);
      setPendingAvatar(null);
      setRemoveAvatar(false);
      setPendingBanner(null);
      setRemoveBanner(false);
      setPendingAvatarPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPendingBannerPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });

      if (saved) socialClient.publishProfile(toPublicPatch(saved));
      setStatus("Alterações salvas.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    setStatus(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setStatus(error.message);
    else {
      setPassword("");
      setStatus("Senha atualizada.");
    }
  }

  function patchVoice(partial: Partial<VoiceSettings>) {
    setVoicePrefs(writeVoiceSettings(partial));
  }

  async function testMic() {
    micTestCleanupRef.current?.();
    micTestCleanupRef.current = null;
    setMicTesting(true);
    setMicLevel(0);
    setStatus(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(micId || undefined, voicePrefs),
      });
      const ctx = new AudioContext();
      await ctx.resume().catch(() => undefined);
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const gain = ctx.createGain();
      gain.gain.value = voicePrefs.inputGain;
      source.connect(gain);
      gain.connect(analyser);
      // Monitor locally so the user can hear themselves during the test
      const dest = ctx.createMediaStreamDestination();
      gain.connect(dest);
      const monitor = new Audio();
      monitor.srcObject = dest.stream;
      monitor.volume = 0.7;
      void applyAudioOutput(monitor, voicePrefs.outputDeviceId);
      void monitor.play().catch(() => undefined);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setMicLevel(Math.min(1, rms * 3.2));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      const stop = () => {
        cancelAnimationFrame(raf);
        monitor.pause();
        monitor.srcObject = null;
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        setMicTesting(false);
        setMicLevel(0);
        micTestCleanupRef.current = null;
        setStatus("Teste de microfone concluído.");
      };
      micTestCleanupRef.current = stop;
      setStatus("Falando… veja o nível abaixo (5s).");
      window.setTimeout(stop, 5000);
    } catch {
      setMicTesting(false);
      setStatus("Não foi possível acessar o microfone.");
    }
  }

  const nav: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "account", label: "Minha conta", icon: <IconKey /> },
    { id: "profile", label: "Editar perfil", icon: <IconUser /> },
    { id: "appearance", label: "Aparência", icon: <IconPalette /> },
    { id: "voice", label: "Voz e vídeo", icon: <IconVideo /> },
    { id: "notifications", label: "Notificações", icon: <IconBell /> },
  ];

  return (
    <div className="settings-overlay">
      <aside className="settings-aside">
        <div className="brand panel-brand">
          <IconSettings />
          Configurações
        </div>
        <nav className="settings-nav">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={section === item.id ? "active" : ""}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <button
          className="neo-btn neo-btn-danger neo-btn-block settings-signout"
          type="button"
          onClick={() => void signOut()}
        >
          Sair da conta
        </button>
      </aside>

      <section className={`settings-main ${section === "profile" ? "settings-main-profile" : ""}`}>
        <div className="settings-top">
          <h2>
            {section === "account" && "Minha conta"}
            {section === "profile" && "Editar perfil"}
            {section === "appearance" && "Aparência"}
            {section === "voice" && "Voz e vídeo"}
            {section === "notifications" && "Notificações"}
          </h2>
          <button className="neo-btn neo-btn-icon" type="button" onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </div>

        {status && section !== "profile" && (
          <p className="muted status-note">{status}</p>
        )}

        {section === "account" && (
          <div className="settings-section">
            <div className="field">
              <label>Email</label>
              <input className="neo-input" value={user?.email ?? ""} readOnly />
            </div>
            <div className="field">
              <label>Usuário</label>
              <input className="neo-input" value={profile?.username ?? ""} readOnly />
            </div>
            <div className="field">
              <label>Nova senha</label>
              <input
                className="neo-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <button
              className="neo-btn neo-btn-primary"
              type="button"
              onClick={() => void changePassword()}
              disabled={password.length < 6}
            >
              Alterar senha
            </button>
          </div>
        )}

        {section === "profile" && (
          <div className="profile-editor">
            <div className="profile-editor-form">
              <p className="muted profile-intro">
                Assim os outros te veem no molezinha. As mudanças só valem depois de salvar.
              </p>
              <div className="field">
                <label>Nome de exibição</label>
                <input
                  className="neo-input"
                  value={displayName}
                  maxLength={32}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Pronomes</label>
                <input
                  className="neo-input"
                  value={pronouns}
                  maxLength={40}
                  placeholder="ele/dele, ela/dela…"
                  onChange={(e) => setPronouns(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Status personalizado</label>
                <input
                  className="neo-input"
                  value={customStatus}
                  maxLength={128}
                  placeholder="O que você está fazendo?"
                  onChange={(e) => setCustomStatus(e.target.value)}
                />
                <div className="muted char-count">
                  {customStatus.length}/128
                </div>
              </div>
              <div className="field">
                <label>Sobre mim</label>
                <textarea
                  className="neo-textarea"
                  rows={4}
                  maxLength={190}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Conte um pouco sobre você"
                />
                <div className="muted char-count">
                  {bio.length}/190
                </div>
              </div>

              <div className="profile-color-row">
                <div className="field field-flush">
                  <label>Cor do banner</label>
                  <NeoColorField
                    value={bannerColor}
                    onChange={setBannerColor}
                    aria-label="Cor do banner"
                  />
                </div>
                <div className="field field-flush">
                  <label>Cor de destaque</label>
                  <NeoColorField
                    value={accentColor}
                    onChange={setAccentColor}
                    aria-label="Cor de destaque"
                  />
                </div>
              </div>

              <input
                ref={avatarRef}
                type="file"
                accept={MEDIA_LIMITS.avatar.accept}
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) openCropper("avatar", file);
                  e.target.value = "";
                }}
              />
              <input
                ref={bannerRef}
                type="file"
                accept={MEDIA_LIMITS.banner.accept}
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) openCropper("banner", file);
                  e.target.value = "";
                }}
              />
              {status && <p className="muted status-note">{status}</p>}
            </div>

            <div className="profile-editor-preview">
              <div className="profile-editor-preview-label">Pré-visualização</div>
              <p className="muted profile-editor-hint">
                Clique no banner ou no avatar para trocar · PNG/JPG/WEBP · até 2MB
              </p>
              <ProfileCard
                displayName={displayName}
                username={profile?.username}
                bio={bio}
                avatarUrl={previewAvatarUrl}
                bannerUrl={previewBannerUrl}
                bannerColor={bannerColor}
                accentColor={accentColor}
                pronouns={pronouns}
                customStatus={customStatus}
                status={profile?.status ?? "online"}
                activity={profile?.activity ?? null}
                editableAvatar
                editableBanner
                onAvatarClick={() => avatarRef.current?.click()}
                onBannerClick={() => bannerRef.current?.click()}
              />
              <div className="profile-media-actions">
                {(previewAvatarUrl || profile?.avatar_url) && !removeAvatar && (
                  <button
                    type="button"
                    className="profile-media-link danger"
                    onClick={() => {
                      setRemoveAvatar(true);
                      setPendingAvatar(null);
                      setPendingAvatarPreview((prev) => {
                        if (prev) URL.revokeObjectURL(prev);
                        return null;
                      });
                    }}
                  >
                    Remover avatar
                  </button>
                )}
                {(previewBannerUrl || profile?.banner_url) && !removeBanner && (
                  <button
                    type="button"
                    className="profile-media-link danger"
                    onClick={() => {
                      setRemoveBanner(true);
                      setPendingBanner(null);
                      setPendingBannerPreview((prev) => {
                        if (prev) URL.revokeObjectURL(prev);
                        return null;
                      });
                    }}
                  >
                    Remover banner
                  </button>
                )}
              </div>
            </div>

            {profileDirty && (
              <div className="profile-unsaved-bar">
                <span>Você tem alterações não salvas.</span>
                <div className="stack-row stack-row-flush">
                  <button className="neo-btn" type="button" disabled={saving} onClick={hydrateFromProfile}>
                    Redefinir
                  </button>
                  <button
                    className="neo-btn neo-btn-primary"
                    type="button"
                    disabled={saving || !displayName.trim()}
                    onClick={() => void saveProfile()}
                  >
                    {saving ? "Salvando…" : "Salvar alterações"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {section === "appearance" && (
          <div className="settings-section settings-section-wide">
            <p className="muted">Modo base, presets e builder — sincroniza na sua conta.</p>
            <div className="theme-grid">
              {(
                [
                  ["dark", "Escuro", "linear-gradient(145deg,#2a2e36,#1a1d24)"],
                  ["light", "Claro", "linear-gradient(145deg,#eef1f5,#d0d5df)"],
                  ["system", "Sistema", "linear-gradient(90deg,#2a2e36 50%,#e4e8f0 50%)"],
                ] as [ThemePreference, string, string][]
              ).map(([value, label, swatch]) => (
                <button
                  key={value}
                  type="button"
                  className={`theme-card ${theme === value && !overridesActive ? "active" : ""}`}
                  onClick={() => void setAppearance(value, baseAppearance(themeSettings))}
                >
                  <div className="theme-swatch" style={{ background: swatch }} />
                  <strong>{label}</strong>
                </button>
              ))}
            </div>

            <div className="theme-base-note">
              <p className="muted">
                {overridesActive
                  ? "Um modo base desliga o preset e as cores personalizadas — elas ficam guardadas."
                  : "Sem preset nem cores personalizadas: o modo base manda."}
              </p>
              {savedCustom && (
                <button
                  className="neo-btn neo-btn-compact"
                  type="button"
                  onClick={() => void setThemeSettings(restoreCustomAppearance(themeSettings))}
                >
                  Voltar às minhas cores
                </button>
              )}
            </div>

            <h3 className="settings-subhead settings-subhead-lg">Presets</h3>
            <div className="theme-grid">
              {THEME_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`theme-card ${themeSettings.presetId === p.id ? "active" : ""}`}
                  onClick={() => {
                    const saved = keepCustomAppearance(themeSettings);
                    void setAppearance(p.mode, saved ? { ...p.settings, saved } : p.settings);
                  }}
                >
                  <div className="theme-swatch" style={{ background: p.swatch }} />
                  <strong>{p.label}</strong>
                </button>
              ))}
            </div>

            <div className="theme-preview neo-inset settings-block-spaced">
              <div className="theme-preview-rail" />
              <div className="theme-preview-body">
                <strong className="display-text">Prévia</strong>
                <p className="muted theme-preview-note">
                  Assim fica o chrome do app.
                </p>
                <button className="neo-btn neo-btn-primary" type="button">
                  Botão accent
                </button>
              </div>
            </div>

            <h3 className="settings-subhead settings-subhead-lg">Cores</h3>
            <div className="theme-color-grid">
              {THEME_COLOR_KEYS.map(({ key, label }) => {
                const base = resolvedTheme === "dark" ? DARK_DEFAULTS : LIGHT_DEFAULTS;
                const value = themeSettings.colors?.[key] ?? base[key];
                return (
                  <NeoColorField
                    key={key}
                    label={label}
                    value={value}
                    onChange={(hex) => {
                      patchCustomTheme({
                        colors: { ...base, ...themeSettings.colors, [key]: hex },
                      });
                    }}
                  />
                );
              })}
            </div>

            <div className="field field-spaced">
              <label htmlFor="theme-radius">Raio ({themeSettings.radiusPx ?? 22}px)</label>
              <NeoRange
                id="theme-radius"
                min={8}
                max={32}
                value={themeSettings.radiusPx ?? 22}
                aria-label="Raio da borda"
                onChange={(radiusPx) => patchCustomTheme({ radiusPx })}
              />
            </div>

            <div className="stack-row stack-row-wrap">
              <div className="field field-grow">
                <label>Fonte display</label>
                <NeoSelect
                  aria-label="Fonte display"
                  value={themeSettings.fontDisplay ?? "Syne"}
                  options={THEME_FONTS.map((f) => ({ value: f.id, label: f.label }))}
                  onChange={(v) => patchCustomTheme({ fontDisplay: v })}
                />
              </div>
              <div className="field field-grow">
                <label>Fonte corpo</label>
                <NeoSelect
                  aria-label="Fonte corpo"
                  value={themeSettings.fontBody ?? "Figtree"}
                  options={THEME_FONTS.map((f) => ({ value: f.id, label: f.label }))}
                  onChange={(v) => patchCustomTheme({ fontBody: v })}
                />
              </div>
            </div>

            <div className="field field-spaced field-flush">
              <button
                className="neo-btn theme-discard"
                type="button"
                onClick={() => void setThemeSettings({})}
              >
                Descartar personalização
              </button>
              <span className="muted field-note">
                Apaga de vez as cores guardadas e volta ao modo base.
              </span>
            </div>
          </div>
        )}

        {section === "voice" && (
          <div className="settings-section">
            <div className="field">
              <label>Microfone</label>
              <NeoSelect
                aria-label="Microfone"
                value={micId}
                placeholder="Padrão do sistema"
                options={[
                  { value: "", label: "Padrão do sistema" },
                  ...mics.map((d) => ({
                    value: d.deviceId,
                    label: d.label || d.deviceId,
                  })),
                ]}
                onChange={(v) => {
                  setMicId(v);
                  localStorage.setItem("molezinha.mic", v);
                }}
              />
            </div>
            <div className="field">
              <label>Saída de áudio</label>
              <NeoSelect
                aria-label="Saída de áudio"
                value={voicePrefs.outputDeviceId}
                placeholder="Padrão do sistema"
                options={[
                  { value: "", label: "Padrão do sistema" },
                  ...speakers.map((d) => ({
                    value: d.deviceId,
                    label: d.label || d.deviceId,
                  })),
                ]}
                onChange={(v) => patchVoice({ outputDeviceId: v })}
              />
            </div>
            <div className="field">
              <label>Câmera</label>
              <NeoSelect
                aria-label="Câmera"
                value={camId}
                placeholder="Padrão do sistema"
                options={[
                  { value: "", label: "Padrão do sistema" },
                  ...cams.map((d) => ({
                    value: d.deviceId,
                    label: d.label || d.deviceId,
                  })),
                ]}
                onChange={(v) => {
                  setCamId(v);
                  localStorage.setItem("molezinha.cam", v);
                }}
              />
            </div>
            <div className="field">
              <label>Qualidade de vídeo</label>
              <NeoSelect
                aria-label="Qualidade de vídeo"
                value={voicePrefs.videoQuality}
                options={VIDEO_QUALITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(v) => patchVoice({ videoQuality: v as VideoQuality })}
              />
              <p className="muted field-note">
                Vale para câmera e compartilhamento de tela. Muda na próxima captura.
              </p>
            </div>
            <div className="settings-block">
              <NeoToggle
                checked={profile?.mute_on_join ?? false}
                onChange={(v) => void updateProfile({ mute_on_join: v })}
                label="Entrar no canal de voz já mutado"
              />
            </div>

            <h3 className="settings-subhead settings-subhead-flush">
              Processamento de áudio
            </h3>
            <div className="voice-toggles">
              <NeoToggle
                checked={voicePrefs.noiseSuppression}
                onChange={(v) => patchVoice({ noiseSuppression: v })}
                label="Supressão de ruído"
              />
              <NeoToggle
                checked={voicePrefs.echoCancellation}
                onChange={(v) => patchVoice({ echoCancellation: v })}
                label="Cancelamento de eco"
              />
              <NeoToggle
                checked={voicePrefs.autoGainControl}
                onChange={(v) => patchVoice({ autoGainControl: v })}
                label="Controle automático de ganho"
              />
            </div>

            <div className="field field-spaced">
              <label>
                Volume de entrada ({Math.round(voicePrefs.inputGain * 100)}%)
              </label>
              <NeoRange
                min={50}
                max={200}
                step={5}
                value={Math.round(voicePrefs.inputGain * 100)}
                aria-label="Volume de entrada"
                onChange={(v) => patchVoice({ inputGain: v / 100 })}
              />
            </div>
            <div className="field">
              <label>
                Volume de saída ({Math.round(voicePrefs.outputVolume * 100)}%)
              </label>
              <NeoRange
                min={0}
                max={100}
                step={5}
                value={Math.round(voicePrefs.outputVolume * 100)}
                aria-label="Volume de saída"
                onChange={(v) => patchVoice({ outputVolume: v / 100 })}
              />
            </div>

            <button
              className="neo-btn"
              type="button"
              onClick={() => void testMic()}
              disabled={micTesting}
            >
              <IconMic />
              {micTesting ? "Testando…" : "Testar microfone"}
            </button>
            {(micTesting || micLevel > 0) && (
              <div className="mic-meter" aria-hidden>
                <div className="mic-meter-fill" style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </div>
            )}

            {isTauri() && (
              <>
                <div className="hotkey-section-head">
                  <div>
                    <h3 className="settings-subhead">Atalhos globais</h3>
                    <p className="muted field-note field-note-flush">
                      Funcionam mesmo com o Molezinha em segundo plano.
                    </p>
                  </div>
                  <button
                    className="neo-btn neo-btn-tiny"
                    type="button"
                    onClick={() => {
                      const next = writeHotkeys(DEFAULT_HOTKEYS);
                      setHotkeys(next);
                    }}
                  >
                    Restaurar padrão
                  </button>
                </div>
                <div className="hotkey-list">
                  <HotkeyRecorder
                    label="Mutar ou desmutar"
                    value={hotkeys.toggleMute}
                    fallback={DEFAULT_HOTKEYS.toggleMute}
                    unavailable={hotkeys.pushToTalk}
                    onChange={(toggleMute) => setHotkeys(writeHotkeys({ toggleMute }))}
                  />
                  <HotkeyRecorder
                    label="Apertar para falar"
                    value={hotkeys.pushToTalk}
                    unavailable={hotkeys.toggleMute}
                    onChange={(pushToTalk) => setHotkeys(writeHotkeys({ pushToTalk }))}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {section === "notifications" && (
          <div className="settings-section">
            <div className="voice-toggles">
              <NeoToggle
                checked={profile?.message_sound ?? true}
                onChange={(v) => {
                  localStorage.setItem("molezinha.messageSound", String(v));
                  void updateProfile({ message_sound: v });
                }}
                label="Som ao receber mensagem"
              />
              <NeoToggle
                checked={notifyPrefs.dms}
                onChange={(v) => setNotifyPrefs(writeNotifyPrefs({ dms: v }))}
                label="Notificar mensagens diretas"
              />
              <NeoToggle
                checked={notifyPrefs.mentions}
                onChange={(v) => setNotifyPrefs(writeNotifyPrefs({ mentions: v }))}
                label="Notificar menções (@)"
              />
              <NeoToggle
                checked={notifyPrefs.desktop}
                onChange={(v) => {
                  const next = writeNotifyPrefs({ desktop: v });
                  setNotifyPrefs(next);
                  if (v) void ensureNotificationPermission();
                }}
                label="Notificações do sistema (janela em segundo plano)"
              />
              <NeoToggle
                checked={profile?.status === "dnd"}
                onChange={(v) => {
                  void updateProfile({ status: v ? "dnd" : "online" });
                }}
                label="Não perturbe (DND)"
              />
              <NeoToggle
                checked={activityDetect}
                onChange={(v) => {
                  writeActivityDetectEnabled(v);
                  setActivityDetect(v);
                }}
                label="Mostrar atividade (jogo / app em foco)"
              />
            </div>

            <h3 className="settings-subhead">
              Horário silencioso
            </h3>
            <div className="stack-row">
              <div className="field field-flush field-grow">
                <label>Início</label>
                <input
                  type="time"
                  className="neo-input"
                  value={timeInputValue(profile?.dnd_start)}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    void updateProfile({ dnd_start: v ? `${v}:00` : null });
                  }}
                />
              </div>
              <div className="field field-flush field-grow">
                <label>Fim</label>
                <input
                  type="time"
                  className="neo-input"
                  value={timeInputValue(profile?.dnd_end)}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    void updateProfile({ dnd_end: v ? `${v}:00` : null });
                  }}
                />
              </div>
            </div>
            <p className="muted field-note">
              No intervalo, só menções passam (se menções estiverem ligadas). Cruza meia-noite sem
              problema.
            </p>

            {isTauri() && (
              <>
                <h3 className="settings-subhead">
                  Atualizações
                </h3>
                <button
                  type="button"
                  className="neo-btn"
                  disabled={updateBusy}
                  onClick={() => {
                    setUpdateBusy(true);
                    setUpdateStatus(null);
                    void checkForAppUpdate().then(async (result) => {
                      setUpdateBusy(false);
                      if (result.status === "unavailable") {
                        setUpdateStatus("Atualizador indisponível neste build.");
                      } else if (result.status === "upToDate") {
                        setUpdateStatus("Você já está na versão mais recente.");
                      } else if (result.status === "error") {
                        setUpdateStatus(result.message);
                      } else {
                        setUpdateStatus(`Nova versão ${result.version}. Baixando…`);
                        try {
                          await result.downloadAndInstall();
                        } catch (err) {
                          setUpdateStatus(
                            err instanceof Error ? err.message : "Falha ao instalar atualização"
                          );
                        }
                      }
                    });
                  }}
                >
                  {updateBusy ? "Verificando…" : "Verificar atualização"}
                </button>
                {updateStatus && (
                  <p className="muted field-note">
                    {updateStatus}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <ImageCropModal
        open={!!cropSource}
        file={cropSource?.file ?? null}
        kind={cropSource?.kind ?? "avatar"}
        onCancel={() => setCropSource(null)}
        onConfirm={(file) => {
          if (cropSource?.kind === "banner") stageBanner(file);
          else stageAvatar(file);
          setCropSource(null);
        }}
      />
    </div>
  );
}
