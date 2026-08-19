import type { PresenceStatus } from "@molezinha/shared";

export const STATUS_OPTIONS: { value: PresenceStatus; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Ausente" },
  { value: "dnd", label: "Não perturbe" },
  { value: "offline", label: "Invisível" },
];

let viewerId: string | null = null;
let onlineIds = new Set<string>();

/** Who is actually connected right now (Realtime Presence). */
export function setPresenceViewer(id: string | null) {
  viewerId = id;
}

export function setOnlineUserIds(ids: Set<string>) {
  onlineIds = ids;
}

export function isUserConnected(userId?: string | null): boolean {
  if (!userId) return false;
  if (viewerId && userId === viewerId) return true;
  return onlineIds.has(userId);
}

/** Voice is an overlay — never replace DND / idle / invisible. */
export function splitPresence(profile: {
  id?: string | null;
  status?: PresenceStatus | null;
  voice_channel_id?: string | null;
}): { status: PresenceStatus; inCall: boolean } {
  const preferred: PresenceStatus =
    !profile.status || profile.status === "in_call" ? "online" : profile.status;
  const connected = isUserConnected(profile.id);
  const inCall =
    connected && (Boolean(profile.voice_channel_id) || profile.status === "in_call");

  if (!connected) {
    return { status: "offline", inCall: false };
  }
  if (preferred === "offline") {
    return { status: "offline", inCall };
  }
  return { status: preferred, inCall };
}

export function isInCallOverlay(profile: {
  id?: string | null;
  status?: PresenceStatus | null;
  voice_channel_id?: string | null;
}) {
  return splitPresence(profile).inCall;
}
