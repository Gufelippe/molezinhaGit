import type { WebSocket } from "ws";
import type {
  PublicProfilePatch,
  SocialServerMessage,
  SocialSignal,
} from "@molezinha/shared";
import { supabaseAdmin, verifySupabaseJwt } from "./auth.js";

interface SocialCtx {
  userId: string | null;
  groupIds: Set<string>;
}

const socketsByUser = new Map<string, Set<WebSocket>>();
const ctxBySocket = new WeakMap<WebSocket, SocialCtx>();

function send(socket: WebSocket, msg: SocialServerMessage) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

async function loadGroupIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);
  if (error) {
    console.warn("[social] loadGroupIds", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r: { group_id: string }) => r.group_id));
}

function registerSocket(userId: string, socket: WebSocket) {
  let set = socketsByUser.get(userId);
  if (!set) {
    set = new Set();
    socketsByUser.set(userId, set);
  }
  set.add(socket);
}

function unregisterSocket(userId: string | null, socket: WebSocket) {
  if (!userId) return;
  const set = socketsByUser.get(userId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) socketsByUser.delete(userId);
}

function sharesGroup(a: Set<string>, b: Set<string>): boolean {
  for (const id of a) {
    if (b.has(id)) return true;
  }
  return false;
}

async function fanoutProfileUpdated(authorId: string, profile: PublicProfilePatch) {
  const authorGroups = await loadGroupIds(authorId);
  if (authorGroups.size === 0) return;

  const payload: SocialServerMessage = { type: "profileUpdated", profile };
  const json = JSON.stringify(payload);

  for (const [userId, sockets] of socketsByUser) {
    if (userId === authorId) continue;
    // Prefer cached groups on any live socket for this user
    let peerGroups: Set<string> | null = null;
    for (const sock of sockets) {
      const ctx = ctxBySocket.get(sock);
      if (ctx?.groupIds.size) {
        peerGroups = ctx.groupIds;
        break;
      }
    }
    if (!peerGroups) {
      peerGroups = await loadGroupIds(userId);
    }
    if (!sharesGroup(authorGroups, peerGroups)) continue;

    for (const sock of sockets) {
      if (sock.readyState === sock.OPEN) sock.send(json);
    }
  }
}

export function attachSocialSocket(socket: WebSocket) {
  const ctx: SocialCtx = { userId: null, groupIds: new Set() };
  ctxBySocket.set(socket, ctx);

  socket.on("message", async (raw) => {
    let data: SocialSignal;
    try {
      data = JSON.parse(String(raw)) as SocialSignal;
    } catch {
      send(socket, { type: "error", message: "Invalid JSON" });
      return;
    }

    try {
      if (data.type === "hello") {
        const auth = await verifySupabaseJwt(data.token);
        if (ctx.userId && ctx.userId !== auth.userId) {
          unregisterSocket(ctx.userId, socket);
        }
        ctx.userId = auth.userId;
        ctx.groupIds = await loadGroupIds(auth.userId);
        registerSocket(auth.userId, socket);
        send(socket, { type: "ready" });
        return;
      }

      if (!ctx.userId) {
        send(socket, { type: "error", message: "Authenticate with hello first" });
        return;
      }

      if (data.type === "profileUpdated") {
        if (data.profile?.id !== ctx.userId) {
          send(socket, { type: "error", message: "profile.id must match authenticated user" });
          return;
        }
        // Refresh membership cache in case groups changed
        ctx.groupIds = await loadGroupIds(ctx.userId);
        await fanoutProfileUpdated(ctx.userId, data.profile);
        return;
      }

      send(socket, { type: "error", message: "Unknown social signal" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      send(socket, { type: "error", message });
    }
  });

  socket.on("close", () => {
    unregisterSocket(ctx.userId, socket);
    ctxBySocket.delete(socket);
  });
}
