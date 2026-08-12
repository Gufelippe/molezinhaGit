import { spawn, type ChildProcess } from "node:child_process";
import { createMusicProducer, closeMusicProducer } from "./botPeer.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

export type PlayerHandle = {
  stop: () => void;
  done: Promise<void>;
};

/**
 * Streams a remote media URL into the channel as Opus/RTP via FFmpeg → PlainTransport.
 */
export async function playUrlIntoChannel(
  channelId: string,
  streamUrl: string
): Promise<PlayerHandle> {
  const { rtpPort, rtcpPort, ssrc, payloadType } = await createMusicProducer(channelId);

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-re",
    "-i",
    streamUrl,
    "-vn",
    "-map",
    "0:a:0?",
    "-acodec",
    "libopus",
    "-ab",
    "128k",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-application",
    "audio",
    "-frame_duration",
    "20",
    "-payload_type",
    String(payloadType),
    "-ssrc",
    String(ssrc),
    "-f",
    "rtp",
    `rtp://127.0.0.1:${rtpPort}?rtcpport=${rtcpPort}`,
  ];

  const proc = spawn(FFMPEG, args, {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let child: ChildProcess | null = proc;

  let settled = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const finish = () => {
    if (settled) return;
    settled = true;
    closeMusicProducer(channelId);
    resolveDone();
  };

  proc.stderr?.on("data", (buf: Buffer) => {
    const line = buf.toString().trim();
    if (line) console.warn("[ffmpeg]", line);
  });

  proc.on("error", (err) => {
    console.warn("[ffmpeg] spawn failed", err);
    child = null;
    finish();
  });

  proc.on("close", () => {
    child = null;
    finish();
  });

  return {
    done,
    stop: () => {
      if (!child) {
        finish();
        return;
      }
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      // Force-kill shortly after if still alive (Windows-friendly).
      setTimeout(() => {
        try {
          child?.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 800);
    },
  };
}
