import type { PresenceStatus } from "@molezinha/shared";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

interface Props {
  name: string;
  url?: string | null;
  id?: string | null;
  size?: AvatarSize;
  /** Renders a coloured ring around the avatar instead of a detached dot. */
  status?: PresenceStatus | null;
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

export function Avatar({ name, url, id, size = "md", status, className = "" }: Props) {
  const initials = name.trim().slice(0, 1).toUpperCase() || "?";
  const hue = hueFor(id ?? name);
  const classes = [
    "avatar",
    `avatar-${size}`,
    status ? `avatar-ring avatar-ring-${status}` : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (url) {
    return (
      <img
        className={classes}
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        style={{ ["--avatar-hue" as string]: String(hue) }}
      />
    );
  }

  return (
    <div className={classes} style={{ ["--avatar-hue" as string]: String(hue) }} aria-hidden>
      {initials}
    </div>
  );
}
