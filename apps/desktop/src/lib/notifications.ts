import type { UnreadSummary } from "@molezinha/shared";
import { supabase } from "./supabase";

const PREFS_KEY = "molezinha.notify";

export type NotifyPrefs = {
  desktop: boolean;
  dms: boolean;
  mentions: boolean;
};

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  desktop: true,
  dms: true,
  mentions: true,
};

export function readNotifyPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_NOTIFY_PREFS };
    const parsed = JSON.parse(raw) as Partial<NotifyPrefs>;
    return {
      desktop: parsed.desktop ?? true,
      dms: parsed.dms ?? true,
      mentions: parsed.mentions ?? true,
    };
  } catch {
    return { ...DEFAULT_NOTIFY_PREFS };
  }
}

export function writeNotifyPrefs(partial: Partial<NotifyPrefs>): NotifyPrefs {
  const next = { ...readNotifyPrefs(), ...partial };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

export function formatBadgeCount(n: number): string {
  if (n <= 0) return "";
  if (n > 99) return "99+";
  return String(n);
}

export async function fetchUnreadSummary(): Promise<UnreadSummary> {
  const { data, error } = await supabase.rpc("get_unread_summary");
  if (error || !data) {
    return { dms: [], channels: [] };
  }
  const raw = data as UnreadSummary;
  return {
    dms: Array.isArray(raw.dms) ? raw.dms : [],
    channels: Array.isArray(raw.channels) ? raw.channels : [],
  };
}

export async function markChannelRead(channelId: string) {
  await supabase.rpc("mark_channel_read", { p_channel_id: channelId });
}

export async function markDmRead(conversationId: string) {
  await supabase.rpc("mark_dm_read", { p_conversation_id: conversationId });
}

export type ToastPayload = {
  id: string;
  title: string;
  body: string;
  avatarUrl?: string | null;
  kind: "dm" | "mention" | "channel";
  onOpen: () => void;
};

export function shouldUseDesktopNotification() {
  return (
    typeof document !== "undefined" &&
    (document.visibilityState === "hidden" || !document.hasFocus())
  );
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function showDesktopNotification(title: string, body: string, onClick?: () => void) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, silent: false });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

/** Parse @username tokens from message content for highlight rendering. */
export function parseMentionTokens(content: string): Array<{ type: "text" | "mention"; value: string }> {
  const parts: Array<{ type: "text" | "mention"; value: string }> = [];
  const re = /@([a-zA-Z0-9_]{2,32})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index > last) {
      parts.push({ type: "text", value: content.slice(last, m.index) });
    }
    parts.push({ type: "mention", value: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    parts.push({ type: "text", value: content.slice(last) });
  }
  if (!parts.length) parts.push({ type: "text", value: content });
  return parts;
}

/** Detect if content mentions a given username (case-insensitive). */
export function contentMentionsUsername(content: string, username: string): boolean {
  if (!username) return false;
  const re = new RegExp(`(^|\\s)@${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-zA-Z0-9_])`, "i");
  return re.test(content);
}
