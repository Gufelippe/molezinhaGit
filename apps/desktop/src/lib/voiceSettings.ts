const STORAGE_KEY = "molezinha.voice";

export type VideoQuality = "low" | "medium" | "high";

export type VoiceSettings = {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Linear gain applied before sending (0.5–2). */
  inputGain: number;
  /** Playback volume for remote call audio (0–1). */
  outputVolume: number;
  /** Speaker / headphones deviceId; empty = system default. */
  outputDeviceId: string;
  /** Capture resolution / bitrate budget for camera and screen share. */
  videoQuality: VideoQuality;
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  inputGain: 1,
  outputVolume: 1,
  outputDeviceId: "",
  videoQuality: "medium",
};

export const VIDEO_QUALITY_OPTIONS: { value: VideoQuality; label: string }[] = [
  { value: "low", label: "Baixa — 360p, economiza banda" },
  { value: "medium", label: "Média — 720p" },
  { value: "high", label: "Alta — 1080p" },
];

type VideoProfile = {
  width: number;
  height: number;
  frameRate: number;
  /** bits per second */
  cameraBitrate: number;
  screenBitrate: number;
};

const VIDEO_PROFILES: Record<VideoQuality, VideoProfile> = {
  low: { width: 640, height: 360, frameRate: 15, cameraBitrate: 300_000, screenBitrate: 600_000 },
  medium: { width: 1280, height: 720, frameRate: 30, cameraBitrate: 1_200_000, screenBitrate: 1_800_000 },
  high: { width: 1920, height: 1080, frameRate: 30, cameraBitrate: 2_500_000, screenBitrate: 4_000_000 },
};

function isVideoQuality(v: unknown): v is VideoQuality {
  return v === "low" || v === "medium" || v === "high";
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function readVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return {
      noiseSuppression: parsed.noiseSuppression ?? true,
      echoCancellation: parsed.echoCancellation ?? true,
      autoGainControl: parsed.autoGainControl ?? true,
      inputGain: clamp(
        typeof parsed.inputGain === "number" ? parsed.inputGain : 1,
        0.5,
        2
      ),
      outputVolume: clamp(
        typeof parsed.outputVolume === "number" ? parsed.outputVolume : 1,
        0,
        1
      ),
      outputDeviceId:
        typeof parsed.outputDeviceId === "string" ? parsed.outputDeviceId : "",
      videoQuality: isVideoQuality(parsed.videoQuality) ? parsed.videoQuality : "medium",
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function writeVoiceSettings(partial: Partial<VoiceSettings>): VoiceSettings {
  const next: VoiceSettings = {
    ...readVoiceSettings(),
    ...partial,
  };
  next.inputGain = clamp(next.inputGain, 0.5, 2);
  next.outputVolume = clamp(next.outputVolume, 0, 1);
  if (typeof next.outputDeviceId !== "string") next.outputDeviceId = "";
  if (!isVideoQuality(next.videoQuality)) next.videoQuality = "medium";
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("molezinha:voice-settings", { detail: next }));
  return next;
}

export function onVoiceSettingsChange(fn: (s: VoiceSettings) => void) {
  const handler = (e: Event) => {
    const ce = e as CustomEvent<VoiceSettings>;
    fn(ce.detail ?? readVoiceSettings());
  };
  window.addEventListener("molezinha:voice-settings", handler);
  return () => window.removeEventListener("molezinha:voice-settings", handler);
}

export function buildAudioConstraints(
  micId?: string | null,
  settings: VoiceSettings = readVoiceSettings()
): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    noiseSuppression: settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoGainControl: settings.autoGainControl,
  };
  if (micId) c.deviceId = { ideal: micId };
  return c;
}

/** Camera constraints for the configured quality. `ideal` so weak webcams still work. */
export function buildVideoConstraints(
  camId?: string | null,
  settings: VoiceSettings = readVoiceSettings()
): MediaTrackConstraints {
  const profile = VIDEO_PROFILES[settings.videoQuality];
  const c: MediaTrackConstraints = {
    width: { ideal: profile.width, max: profile.width },
    height: { ideal: profile.height, max: profile.height },
    frameRate: { ideal: profile.frameRate, max: profile.frameRate },
  };
  if (camId) c.deviceId = { ideal: camId };
  return c;
}

/** Screen capture constraints — same budget, but never upscale past the real display. */
export function buildScreenConstraints(
  settings: VoiceSettings = readVoiceSettings()
): MediaTrackConstraints {
  const profile = VIDEO_PROFILES[settings.videoQuality];
  return {
    width: { max: profile.width },
    height: { max: profile.height },
    frameRate: { ideal: profile.frameRate, max: profile.frameRate },
  };
}

/** Encoding bitrate cap handed to mediasoup on produce. */
export function videoBitrate(
  source: "camera" | "screen",
  settings: VoiceSettings = readVoiceSettings()
): number {
  const profile = VIDEO_PROFILES[settings.videoQuality];
  return source === "screen" ? profile.screenBitrate : profile.cameraBitrate;
}

/** Update processing flags on a live track (mid-call). */
export async function applyVoiceProcessing(
  track: MediaStreamTrack,
  settings: VoiceSettings = readVoiceSettings()
) {
  if (track.kind !== "audio") return;
  try {
    await track.applyConstraints({
      noiseSuppression: settings.noiseSuppression,
      echoCancellation: settings.echoCancellation,
      autoGainControl: settings.autoGainControl,
    });
  } catch (err) {
    console.warn("[voice] applyConstraints failed", err);
  }
}

type SinkElement = HTMLMediaElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
  sinkId?: string;
};

/** Route playback to the chosen output device (Chromium / WebView2). */
export async function applyAudioOutput(
  el: HTMLMediaElement,
  deviceId: string = readVoiceSettings().outputDeviceId
) {
  const sink = el as SinkElement;
  if (typeof sink.setSinkId !== "function") return;
  const id = deviceId || "";
  if (sink.sinkId === id) return;
  try {
    await sink.setSinkId(id);
  } catch (err) {
    console.warn("[voice] setSinkId failed", err);
  }
}
