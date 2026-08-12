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
): Promise<{ groupId: string; displayName: string }> {
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
    .select("display_name, username")
    .eq("id", userId)
    .maybeSingle();

  return {
    groupId: channel.group_id,
    displayName: profile?.display_name ?? profile?.username ?? "Amigo",
  };
}

export async function setVoicePresence(
  userId: string,
  voiceChannelId: string | null
) {
  await supabaseAdmin
    .from("profiles")
    .update({
      status: voiceChannelId ? "in_call" : "online",
      voice_channel_id: voiceChannelId,
    })
    .eq("id", userId);
}
