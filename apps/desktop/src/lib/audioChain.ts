import {
  NoiseGateWorkletNode,
  RnnoiseWorkletNode,
  loadRnnoise,
} from "@sapphi-red/web-noise-suppressor";
import noiseGateWorkletUrl from "@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import { GATE_OFF_DB, readVoiceSettings, type VoiceSettings } from "./voiceSettings";

/** RNNoise is trained on 48kHz mono frames. */
const SAMPLE_RATE = 48_000;
/** Rumble and desk thumps live below this; speech does not. */
const HIGHPASS_HZ = 90;
/** Hysteresis so the gate doesn't chatter on word endings. */
const GATE_HYSTERESIS_DB = 8;
const GATE_HOLD_MS = 220;

export type VoiceChain = {
  /** Processed track to send to the call. */
  track: MediaStreamTrack;
  setGain: (value: number) => void;
  /** True while the graph is actually producing samples. */
  isLive: () => boolean;
  /** Re-kick WebView2 autoplay policy if the context went suspended. */
  resume: () => Promise<boolean>;
  close: () => void;
};

let rnnoiseBinary: Promise<ArrayBuffer> | null = null;

function getRnnoiseBinary() {
  rnnoiseBinary ??= loadRnnoise({
    url: rnnoiseWasmUrl,
    simdUrl: rnnoiseSimdWasmUrl,
  }).catch((err) => {
    rnnoiseBinary = null;
    throw err;
  });
  return rnnoiseBinary;
}

/** Warm the wasm + worklet cache so the first join isn't delayed by the fetch. */
export function preloadNoiseSuppressor() {
  void getRnnoiseBinary().catch(() => undefined);
}

/** Whether the raw mic track already is what we want to send. */
export function needsVoiceChain(settings: VoiceSettings) {
  return (
    settings.noiseSuppression === "strong" ||
    settings.noiseGate > GATE_OFF_DB ||
    settings.inputGain !== 1
  );
}

/**
 * WebView2 / Chromium often create AudioContexts as `suspended` when the
 * constructor runs after an async gap (join handshake). A suspended context
 * still yields a live MediaStreamTrack — it just carries silence. Wait briefly
 * for resume; if it never runs, the caller must fall back to the raw mic.
 */
export async function ensureAudioContextRunning(context: AudioContext): Promise<boolean> {
  if (context.state === "closed") return false;
  if (context.state === "running") return true;
  try {
    await context.resume();
  } catch {
    /* ignore */
  }
  if (context.state === "running") return true;
  await new Promise<void>((resolve) => {
    const done = () => {
      context.removeEventListener("statechange", onChange);
      window.clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (context.state === "running" || context.state === "closed") done();
    };
    const timer = window.setTimeout(done, 400);
    context.addEventListener("statechange", onChange);
    void context.resume().catch(() => undefined);
  });
  return context.state === "running";
}

/**
 * Builds the outgoing mic chain: high-pass → RNNoise → noise gate → gain.
 *
 * The browser suppressor only models stationary noise, so keyboard clicks and
 * finger snaps ride straight through it. RNNoise removes those while speaking
 * and the gate mutes whatever is left in the gaps between sentences.
 *
 * Returns `null` when no processing is configured — sending the raw track is
 * always the lowest latency option.
 */
export async function createVoiceChain(
  raw: MediaStreamTrack,
  settings: VoiceSettings = readVoiceSettings()
): Promise<VoiceChain | null> {
  if (!needsVoiceChain(settings)) return null;

  const context = new AudioContext({
    sampleRate: SAMPLE_RATE,
    latencyHint: "interactive",
  });
  let denoiser: RnnoiseWorkletNode | null = null;
  let closed = false;

  try {
    if (!(await ensureAudioContextRunning(context))) {
      throw new Error("AudioContext suspenso — microfone processado sairia mudo");
    }

    const source = context.createMediaStreamSource(new MediaStream([raw]));

    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = HIGHPASS_HZ;
    // The worklets below are mono-only; downmix here so a stereo mic keeps both
    // sides of the room instead of losing one channel.
    highpass.channelCount = 1;
    highpass.channelCountMode = "explicit";
    source.connect(highpass);
    let tail: AudioNode = highpass;

    if (settings.noiseSuppression === "strong") {
      try {
        const wasmBinary = await getRnnoiseBinary();
        // Worklet load can take long enough for autoplay policy to re-suspend.
        if (!(await ensureAudioContextRunning(context))) {
          throw new Error("AudioContext suspenso após carregar RNNoise");
        }
        await context.audioWorklet.addModule(rnnoiseWorkletUrl);
        denoiser = new RnnoiseWorkletNode(context, {
          maxChannels: 1,
          wasmBinary,
        });
        tail.connect(denoiser);
        tail = denoiser;
      } catch (err) {
        console.warn("[voice] RNNoise indisponível, seguindo sem ele", err);
      }
    }

    if (settings.noiseGate > GATE_OFF_DB) {
      try {
        await context.audioWorklet.addModule(noiseGateWorkletUrl);
        const gate = new NoiseGateWorkletNode(context, {
          openThreshold: settings.noiseGate,
          closeThreshold: settings.noiseGate - GATE_HYSTERESIS_DB,
          holdMs: GATE_HOLD_MS,
          maxChannels: 1,
        });
        tail.connect(gate);
        tail = gate;
      } catch (err) {
        console.warn("[voice] noise gate indisponível", err);
      }
    }

    const gain = context.createGain();
    gain.gain.value = settings.inputGain;
    tail.connect(gain);

    const destination = context.createMediaStreamDestination();
    destination.channelCount = 1;
    gain.connect(destination);

    if (!(await ensureAudioContextRunning(context))) {
      throw new Error("AudioContext suspenso ao finalizar a cadeia de voz");
    }

    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error("Falha ao processar o áudio do microfone.");

    const resume = async () => {
      if (closed || context.state === "closed") return false;
      return ensureAudioContextRunning(context);
    };

    // Keep trying if the OS / WebView parks the graph mid-call (minimize, sleep).
    const onStateChange = () => {
      if (closed || context.state !== "suspended") return;
      void context.resume().catch(() => undefined);
    };
    context.addEventListener("statechange", onStateChange);

    return {
      track,
      setGain: (value) => {
        gain.gain.value = value;
      },
      isLive: () => !closed && context.state === "running",
      resume,
      close: () => {
        closed = true;
        context.removeEventListener("statechange", onStateChange);
        try {
          denoiser?.destroy();
        } catch {
          /* ignore */
        }
        void context.close().catch(() => undefined);
      },
    };
  } catch (err) {
    try {
      denoiser?.destroy();
    } catch {
      /* ignore */
    }
    void context.close().catch(() => undefined);
    throw err;
  }
}
