type IconProps = { className?: string };

export function IconHash({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18" strokeLinecap="round" />
    </svg>
  );
}

export function IconSpeaker({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 7a7 7 0 0 1 0 10" strokeLinecap="round" />
    </svg>
  );
}

export function IconSettings({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconPlus({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

export function IconJoin({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v10m0 0-4-4m4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" strokeLinecap="round" />
    </svg>
  );
}

export function IconUser({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19a7 7 0 0 1 14 0" strokeLinecap="round" />
    </svg>
  );
}

export function IconMic({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

export function IconMicOff({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m4 4 16 16" strokeLinecap="round" />
      <path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9V7a3 3 0 0 0-4.2-2.7" strokeLinecap="round" />
      <path d="M5 11a7 7 0 0 0 11.5 5.3M19 11v0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

export function IconHeadphones({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" strokeLinecap="round" />
      <rect x="2" y="13" width="5" height="8" rx="2" />
      <rect x="17" y="13" width="5" height="8" rx="2" />
    </svg>
  );
}

export function IconHeadphonesOff({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 14v-2a8 8 0 0 1 13.2-6.2" strokeLinecap="round" />
      <rect x="2" y="13" width="5" height="8" rx="2" />
      <path d="M17 17.5V21a2 2 0 0 0 2 2h1" strokeLinecap="round" />
      <path d="m4 4 16 16" strokeLinecap="round" />
    </svg>
  );
}

export function IconVideo({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="7" width="12" height="10" rx="2" />
      <path d="m15 10 5-2v8l-5-2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconVideoOff({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 11.5V9a2 2 0 0 0-2-2H8.5" strokeLinejoin="round" />
      <path d="M4.2 7.6A2 2 0 0 0 3 9.4V15a2 2 0 0 0 2 2h8" strokeLinejoin="round" />
      <path d="m15 10 5-2v8l-2.4-1" strokeLinejoin="round" />
      <path d="m4 4 16 16" strokeLinecap="round" />
    </svg>
  );
}

export function IconPhoneOff({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 14c1.2.6 2.5 1 3.9 1.1l1.6-1.6a1 1 0 0 1 1.1-.2 10.4 10.4 0 0 1 2.3 1.5 1 1 0 0 1 .3 1.2l-1.2 2.5a1 1 0 0 1-1.1.6A17 17 0 0 1 3.9 4.1a1 1 0 0 1 .6-1.1L7 1.8a1 1 0 0 1 1.2.3 10.4 10.4 0 0 1 1.5 2.3 1 1 0 0 1-.2 1.1L8.1 7.1c.1 1.4.5 2.7 1.1 3.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m4 4 16 16" strokeLinecap="round" />
    </svg>
  );
}

export function IconSend({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m5 12 14-7-4 14-3-5-7-2Z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSmile({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 10h.01M15.5 10h.01" strokeLinecap="round" />
      <path d="M8.2 14c1.1 1.3 2.4 2 3.8 2s2.7-.7 3.8-2" strokeLinecap="round" />
    </svg>
  );
}

export function IconSticker({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5-6Z"
        strokeLinejoin="round"
      />
      <path d="M13 3v6h6" strokeLinejoin="round" />
      <path d="M8.5 13.5c1.2 1.4 2.5 2.1 3.5 2.1s2.3-.7 3.5-2.1" strokeLinecap="round" />
      <circle cx="9.2" cy="11" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="11" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClose({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}

export function IconPalette({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12" strokeLinejoin="round" />
      <circle cx="7.5" cy="10" r="1" fill="currentColor" />
      <circle cx="10.5" cy="7" r="1" fill="currentColor" />
      <circle cx="14.5" cy="7.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function IconBell({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}

export function IconKey({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8 2 2-2 2-2-1-1 2-2-1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFriends({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19a6 6 0 0 1 12 0" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M14.5 19a5 5 0 0 1 7.5-4.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconReply({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 14 4 9l5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" strokeLinecap="round" />
    </svg>
  );
}

export function IconForward({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m15 14 5-5-5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" strokeLinecap="round" />
    </svg>
  );
}

export function IconCopy({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" strokeLinecap="round" />
    </svg>
  );
}

export function IconPin({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 17v5M9 3h6l-1 7h3l-5 5-5-5h3L9 3Z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTrash({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m1 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" strokeLinejoin="round" />
      <path d="M10 11v6M14 11v6" strokeLinecap="round" />
    </svg>
  );
}

export function IconUnread({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19a7 7 0 0 1 11.5-5.3" strokeLinecap="round" />
      <path d="M17 14v4m0 0-1.5-1.5M17 18l1.5-1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSearch({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconPaperclip({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="m21.44 11.05-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a1.5 1.5 0 1 1-2.12-2.12l7.78-7.78"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconBookmark({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.5L6 20V5a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconScreen({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" strokeLinecap="round" />
    </svg>
  );
}

export function IconMegaphone({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m3 11 13-5v12L3 13v-2Z" strokeLinejoin="round" />
      <path d="M16 8.5v7M19.5 9.5a4 4 0 0 1 0 5" strokeLinecap="round" />
      <path d="M7 13v4a2 2 0 0 0 2 2h1" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheck({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m5 13 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconAt({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3.6" />
      <path d="M15.6 8.4v4.6a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.4 6.9" strokeLinecap="round" />
    </svg>
  );
}

export function IconPoll({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M6 19v-6M12 19V5M18 19v-9" strokeLinecap="round" />
    </svg>
  );
}

export function IconMusic({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18V5l12-2v13" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function IconExpand({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCollapse({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFullscreen({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFullscreenExit({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M9 20v-4a1 1 0 0 0-1-1H4M15 20v-4a1 1 0 0 1 1-1h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconBellOff({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8.2 5.4A5 5 0 0 1 17 9v4l1.5 3H7" strokeLinejoin="round" />
      <path d="M5.5 16 7 13V9a5 5 0 0 1 .3-1.7" strokeLinejoin="round" />
      <path d="M10.5 19a1.8 1.8 0 0 0 3 0" strokeLinecap="round" />
      <path d="m4 4 16 16" strokeLinecap="round" />
    </svg>
  );
}
