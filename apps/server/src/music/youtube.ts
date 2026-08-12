import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const YT_DLP = process.env.YT_DLP_PATH || "yt-dlp";

export type YoutubeMeta = {
  url: string;
  title: string;
  thumbnail: string | null;
  streamUrl: string;
};

const YOUTUBE_RE =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]+/i;

export function isYoutubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (!/(^|\.)youtube\.com$/i.test(u.hostname) && !/(^|\.)youtu\.be$/i.test(u.hostname)) {
      return false;
    }
    return YOUTUBE_RE.test(raw.trim()) || u.searchParams.has("v") || u.pathname.length > 1;
  } catch {
    return false;
  }
}

/** Reject playlist / mix / radio links for the MVP. */
export function assertSingleVideoUrl(url: string) {
  const u = new URL(url);
  if (u.searchParams.has("list") || u.pathname.includes("/playlist")) {
    throw new Error("Playlists não são suportadas — cole o link de um vídeo só.");
  }
}

export async function resolveYoutube(url: string): Promise<YoutubeMeta> {
  if (!isYoutubeUrl(url)) throw new Error("Link do YouTube inválido");
  assertSingleVideoUrl(url);

  // -f ba/bestaudio: audio-only when available; fallback to best.
  // -g prints the direct media URL; --print prints metadata fields.
  const { stdout } = await execFileAsync(
    YT_DLP,
    [
      "--no-playlist",
      "--no-warnings",
      "-f",
      "bestaudio/best",
      "--print",
      "%(title)s\n%(thumbnail)s\n%(url)s",
      url,
    ],
    {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    }
  );

  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) {
    throw new Error("Não foi possível extrair o áudio deste vídeo");
  }

  const title = lines[0] || "YouTube";
  const thumbnail = lines[1] && lines[1] !== "NA" ? lines[1] : null;
  const streamUrl = lines[lines.length - 1];
  if (!streamUrl.startsWith("http")) {
    throw new Error("Não foi possível obter a stream de áudio");
  }

  return { url, title, thumbnail, streamUrl };
}
