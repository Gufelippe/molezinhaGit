import type { MusicChannelState } from "@molezinha/shared";
import { CALLS_URL, supabase } from "./supabase";

/** Derive the HTTP origin of the calls server from the WS URL. */
export function callsHttpBase(): string {
  try {
    const u = new URL(CALLS_URL);
    u.protocol = u.protocol === "wss:" ? "https:" : "http:";
    u.pathname = "";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return "http://127.0.0.1:3001";
  }
}

async function authHeader(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Faça login novamente");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function musicFetch(
  channelId: string,
  path: string,
  init?: RequestInit
): Promise<MusicChannelState> {
  const res = await fetch(`${callsHttpBase()}/music/${channelId}${path}`, {
    ...init,
    headers: {
      ...(await authHeader()),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as MusicChannelState & { error?: string };
  if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
  return body;
}

export const musicApi = {
  state: (channelId: string) => musicFetch(channelId, "/state"),
  play: (channelId: string, url: string) =>
    musicFetch(channelId, "/play", { method: "POST", body: JSON.stringify({ url }) }),
  skip: (channelId: string) => musicFetch(channelId, "/skip", { method: "POST", body: "{}" }),
  stop: (channelId: string) => musicFetch(channelId, "/stop", { method: "POST", body: "{}" }),
  remove: (channelId: string, trackId: string) =>
    musicFetch(channelId, "/remove", {
      method: "POST",
      body: JSON.stringify({ trackId }),
    }),
};

const YT_ONLY =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+|youtube\.com\/shorts\/[\w-]+)(\S*)?$/i;

export function extractYoutubeUrl(text: string): string | null {
  const t = text.trim();
  if (!YT_ONLY.test(t)) return null;
  try {
    const u = new URL(t.startsWith("http") ? t : `https://${t}`);
    if (u.searchParams.has("list")) return null;
    return u.toString();
  } catch {
    return null;
  }
}
