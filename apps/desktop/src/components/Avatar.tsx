import type { PresenceStatus } from "@molezinha/shared";
import { IconHeadphones } from "./Icons";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

interface Props {
  name: string;
  url?: string | null;
  id?: string | null;
  size?: AvatarSize;
  /** Real presence — `in_call` is treated as online plus the headset overlay. */
  status?: PresenceStatus | null;
  inCall?: boolean;
  speaking?: boolean;
  className?: string;
}

/** Stable hue per user id so a fallback avatar always looks like that person. */
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return h;
}

function badgeStatus(status?: PresenceStatus | null): PresenceStatus | null {
  if (!status) return null;
  if (status === "in_call") return "online";
  return status;
}

export function Avatar({
  name,
  url,
  id,
  size = "md",
  status,
  inCall = false,
  speaking = false,
  className = "",
}: Props) {
  const initials = name.trim().slice(0, 1).toUpperCase() || "?";
  const hue = hueFor(id ?? name);
  const badge = badgeStatus(status);
  const showCall = inCall || status === "in_call";
  const wrapClass = [
    "avatar-wrap",
    `avatar-wrap-${size}`,
    speaking ? "speaking" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const faceClass = ["avatar", `avatar-${size}`].join(" ");
  const style = { ["--avatar-hue" as string]: String(hue) };

  return (
    <span className={wrapClass} style={style}>
      {url ? (
        <img className={faceClass} src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className={faceClass} aria-hidden>
          {initials}
        </span>
      )}
      {badge && (
        <span
          className={`avatar-badge avatar-badge-${badge}${showCall ? " has-call" : ""}`}
          aria-hidden
        >
          {showCall && <IconHeadphones className="avatar-call-icon" />}
        </span>
      )}
    </span>
  );
}
