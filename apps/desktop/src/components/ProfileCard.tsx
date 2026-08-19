import type { ReactNode } from "react";
import type { Profile, UserActivity } from "@molezinha/shared";
import { activityLabel } from "../lib/activity";

type Props = {
  displayName: string;
  username?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bannerColor?: string | null;
  accentColor?: string | null;
  pronouns?: string | null;
  customStatus?: string | null;
  status?: Profile["status"] | null;
  inCall?: boolean;
  activity?: UserActivity | null;
  editableAvatar?: boolean;
  editableBanner?: boolean;
  onAvatarClick?: () => void;
  onBannerClick?: () => void;
  footer?: ReactNode;
};

function statusClass(status: Profile["status"] | null | undefined) {
  if (status === "offline") return "offline";
  if (status === "idle") return "idle";
  if (status === "dnd") return "dnd";
  return "";
}

export function ProfileCard({
  displayName,
  username,
  bio,
  avatarUrl,
  bannerUrl,
  bannerColor = "#3d6b5a",
  accentColor = "#7eb89f",
  pronouns,
  customStatus,
  status = "online",
  inCall = false,
  activity = null,
  editableAvatar = false,
  editableBanner = false,
  onAvatarClick,
  onBannerClick,
  footer,
}: Props) {
  const initial = (displayName || "?")[0]?.toUpperCase();
  const bannerStyle = bannerUrl
    ? { backgroundImage: `url(${bannerUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: bannerColor ?? "#3d6b5a" };
  const activityText = activityLabel(activity);

  const banner = (
    <div className="profile-card-banner" style={bannerStyle} aria-hidden={!editableBanner}>
      {editableBanner && (
        <span className="profile-card-banner-overlay">Alterar banner</span>
      )}
    </div>
  );

  return (
    <div className="profile-card" style={{ ["--profile-accent" as string]: accentColor ?? "#7eb89f" }}>
      {editableBanner ? (
        <button type="button" className="profile-card-banner-hit" onClick={onBannerClick} aria-label="Alterar banner">
          {banner}
        </button>
      ) : (
        banner
      )}
      <div className="profile-card-body">
        <div className="profile-card-avatar-wrap">
          {editableAvatar ? (
            <button
              type="button"
              className="profile-card-avatar-btn"
              onClick={onAvatarClick}
              aria-label="Alterar avatar"
            >
              {avatarUrl ? (
                <img className="profile-card-avatar" src={avatarUrl} alt="" />
              ) : (
                <div className="profile-card-avatar profile-card-avatar-fallback">{initial}</div>
              )}
              <span className="profile-card-avatar-overlay">Alterar</span>
            </button>
          ) : avatarUrl ? (
            <img className="profile-card-avatar" src={avatarUrl} alt="" />
          ) : (
            <div className="profile-card-avatar profile-card-avatar-fallback">{initial}</div>
          )}
          <span
            className={`profile-card-status status-dot ${statusClass(status === "in_call" ? "online" : status)}${inCall || status === "in_call" ? " in-voice" : ""}`}
          />
        </div>

        <div className="profile-card-identity">
          <div className="profile-card-name">{displayName || "Sem nome"}</div>
          <div className="profile-card-username-row">
            {username && <span className="profile-card-username">@{username}</span>}
            {pronouns?.trim() && <span className="profile-card-pronouns">{pronouns.trim()}</span>}
          </div>
          {customStatus?.trim() && (
            <div className="profile-card-custom-status">{customStatus.trim()}</div>
          )}
          {activityText && <div className="profile-card-activity">{activityText}</div>}
        </div>

        <div className="profile-card-section">
          <div className="profile-card-section-title">Sobre mim</div>
          <p className="profile-card-bio">{bio?.trim() ? bio : "Nada por aqui ainda."}</p>
        </div>

        {footer}
      </div>
    </div>
  );
}
