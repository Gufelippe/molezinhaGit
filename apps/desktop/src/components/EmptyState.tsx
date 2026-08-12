import type { ReactNode } from "react";

export type EmptyArt =
  | "messages"
  | "dms"
  | "pins"
  | "bookmarks"
  | "search"
  | "friends"
  | "voice";

interface Props {
  art?: EmptyArt;
  title: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Embossed line art for empty screens. Everything is drawn with currentColor so
 * the illustrations pick up the server accent from CSS.
 */
function Art({ art }: { art: EmptyArt }) {
  switch (art) {
    case "dms":
      return (
        <>
          <rect className="empty-art-plate" x="14" y="20" width="62" height="44" rx="14" />
          <path className="empty-art-line" d="M26 36h34M26 46h22" />
          <circle className="empty-art-dot" cx="72" cy="62" r="9" />
        </>
      );
    case "pins":
      return (
        <>
          <rect className="empty-art-plate" x="20" y="14" width="50" height="58" rx="12" />
          <path className="empty-art-line" d="M32 34h26M32 44h18" />
          <path className="empty-art-accent" d="M64 12v14m-7-7h14" />
        </>
      );
    case "bookmarks":
      return (
        <>
          <path className="empty-art-plate" d="M26 14h38a6 6 0 0 1 6 6v54l-25-16-25 16V20a6 6 0 0 1 6-6Z" />
          <path className="empty-art-line" d="M38 34h14" />
        </>
      );
    case "search":
      return (
        <>
          <circle className="empty-art-plate" cx="40" cy="38" r="22" />
          <path className="empty-art-accent" d="m57 55 16 16" />
          <path className="empty-art-line" d="M32 38h16" />
        </>
      );
    case "friends":
      return (
        <>
          <circle className="empty-art-plate" cx="34" cy="32" r="14" />
          <path className="empty-art-plate" d="M12 70c0-11 10-18 22-18s22 7 22 18" />
          <circle className="empty-art-accent" cx="68" cy="42" r="10" />
        </>
      );
    case "voice":
      return (
        <>
          <rect className="empty-art-plate" x="34" y="12" width="22" height="34" rx="11" />
          <path className="empty-art-line" d="M24 40a21 21 0 0 0 42 0M45 61v11" />
          <path className="empty-art-accent" d="M14 30v10M76 30v10" />
        </>
      );
    case "messages":
    default:
      return (
        <>
          <rect className="empty-art-plate" x="10" y="16" width="54" height="38" rx="12" />
          <rect className="empty-art-accent-plate" x="34" y="34" width="46" height="34" rx="12" />
          <path className="empty-art-line" d="M22 30h26M22 40h14" />
        </>
      );
  }
}

export function EmptyState({ art = "messages", title, hint, children, className = "" }: Props) {
  return (
    <div className={`empty-state ${className}`.trim()}>
      <svg className="empty-art" viewBox="0 0 90 84" aria-hidden fill="none">
        <Art art={art} />
      </svg>
      <strong className="empty-state-title">{title}</strong>
      {hint && <p className="empty-state-hint muted">{hint}</p>}
      {children}
    </div>
  );
}
