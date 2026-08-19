import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import ws from "ws";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseSecret = process.env.SUPABASE_SECRET_KEY ?? "";
const jwksUrl =
  process.env.SUPABASE_JWKS_URL ??
  `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;

if (!supabaseUrl || !supabaseSecret) {
  console.warn(
    "[molezinha-server] SUPABASE_URL / SUPABASE_SECRET_KEY missing — membership checks will fail until configured."
  );
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseSecret, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: {
    transport: ws as unknown as typeof WebSocket,
  },
});

const JWKS = createRemoteJWKSet(new URL(jwksUrl));

export interface AuthUser {
  userId: string;
  email?: string;
}

export async function verifySupabaseJwt(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, JWKS, {
    algorithms: ["ES256", "RS256", "HS256"],
  });

  const userId = typeof payload.sub === "string" ? payload.sub : null;
  if (!userId) {
    throw new Error("Invalid token: missing sub");
  }

  return {
    userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

export async function assertChannelMembership(
  userId: string,
  channelId: string
): Promise<{
  groupId: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  avatarUrl: string | null;
}> {
  const { data: channel, error: channelError } = await supabaseAdmin
    .from("channels")
    .select("id, group_id, type, is_private")
    .eq("id", channelId)
    .maybeSingle();

  if (channelError || !channel) {
    throw new Error("Channel not found");
  }
  if (channel.type !== "voice") {
    throw new Error("Not a voice channel");
  }

  const { data: member, error: memberError } = await supabaseAdmin
    .from("group_members")
    .select("user_id, role")
    .eq("group_id", channel.group_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError || !member) {
    throw new Error("Not a group member");
  }

  if (channel.is_private) {
    const isStaff = member.role === "owner" || member.role === "admin";
    if (!isStaff) {
      const { data: access } = await supabaseAdmin
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", channelId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!access) {
        throw new Error("No access to this channel");
      }
    }
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("display_name, username, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  const role = (member.role as "owner" | "admin" | "member") ?? "member";

  return {
    groupId: channel.group_id,
    displayName: profile?.display_name ?? profile?.username ?? "Amigo",
    role,
    avatarUrl: profile?.avatar_url ?? null,
  };
}

export async function setVoicePresence(
  userId: string,
  voiceChannelId: string | null
) {
  await supabaseAdmin
    .from("profiles")
    .update({
      voice_channel_id: voiceChannelId,
    })
    .eq("id", userId);
}

export async function loadGroupVoiceModeration(groupId: string) {
  const { data } = await supabaseAdmin
    .from("group_members")
    .select("user_id, server_muted, server_deafened")
    .eq("group_id", groupId);
  return (data ?? [])
    .filter((row) => row.server_muted || row.server_deafened)
    .map((row) => ({
      userId: row.user_id as string,
      muted: Boolean(row.server_muted),
      deafened: Boolean(row.server_deafened),
    }));
}

function roleRank(role: string) {
  if (role === "owner") return 3;
  if (role === "admin") return 2;
  if (role === "member") return 1;
  return 0;
}

export async function assertCanModerateVoice(
  actorId: string,
  groupId: string,
  targetId: string
) {
  if (actorId === targetId) throw new Error("Você não pode se moderar");
  const { data } = await supabaseAdmin
    .from("group_members")
    .select("user_id, role")
    .eq("group_id", groupId)
    .in("user_id", [actorId, targetId]);
  const actor = data?.find((r) => r.user_id === actorId);
  const target = data?.find((r) => r.user_id === targetId);
  if (!actor || roleRank(actor.role) < 2) throw new Error("Sem permissão");
  if (!target) throw new Error("Membro não encontrado");
  if (roleRank(actor.role) <= roleRank(target.role)) {
    throw new Error("Você não pode moderar este membro");
  }
}
