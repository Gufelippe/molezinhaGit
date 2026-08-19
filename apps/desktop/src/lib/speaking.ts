import { ensureAudioContextRunning } from "./audioChain";

const RMS_THRESHOLD = 0.055;
const SPEAKING_HOLD_MS = 280;

type AnalyserEntry = {
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  data: Uint8Array<ArrayBuffer>;
  trackId: string;
};

/**
 * Shared AnalyserNode graph for local + remote mics. RMS above the threshold
 * lights the speaking ring on tiles, the roster, and the voice-channel list.
 */
export class SpeakingMonitor {
  private ctx: AudioContext | null = null;
  private entries = new Map<string, AnalyserEntry>();
  private speaking = new Set<string>();
  private lastAbove = new Map<string, number>();
  private raf = 0;
  private listeners = new Set<(ids: Set<string>) => void>();

  onChange(fn: (ids: Set<string>) => void) {
    this.listeners.add(fn);
    fn(new Set(this.speaking));
    return () => {
      this.listeners.delete(fn);
    };
  }

  current() {
    return new Set(this.speaking);
  }

  private emit() {
    const snapshot = new Set(this.speaking);
    for (const fn of this.listeners) fn(snapshot);
  }

  private async context() {
    this.ctx ??= new AudioContext({ latencyHint: "interactive" });
    await ensureAudioContextRunning(this.ctx);
    return this.ctx;
  }

  async attach(id: string, stream: MediaStream | null) {
    const track = stream?.getAudioTracks().find((t) => t.readyState === "live") ?? null;
    const existing = this.entries.get(id);
    if (!track) {
      this.detach(id);
      return;
    }
    if (existing?.trackId === track.id) return;

    this.detach(id);
    try {
      const ctx = await this.context();
      if (ctx.state === "closed") return;
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      this.entries.set(id, {
        analyser,
        source,
        data: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
        trackId: track.id,
      });
      this.start();
    } catch (err) {
      console.warn("[call] speaking analyser failed", err);
    }
  }

  detach(id: string) {
    const entry = this.entries.get(id);
    if (entry) {
      try {
        entry.source.disconnect();
      } catch {
        /* ignore */
      }
      this.entries.delete(id);
    }
    this.lastAbove.delete(id);
    if (this.speaking.delete(id)) this.emit();
    if (this.entries.size === 0) this.stop();
  }

  keep(ids: Set<string>) {
    for (const id of [...this.entries.keys()]) {
      if (!ids.has(id)) this.detach(id);
    }
  }

  close() {
    this.stop();
    for (const id of [...this.entries.keys()]) this.detach(id);
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    this.speaking.clear();
    this.emit();
  }

  private start() {
    if (this.raf) return;
    const tick = () => {
      this.raf = 0;
      if (this.entries.size === 0) return;
      const now = performance.now();
      let changed = false;
      for (const [id, entry] of this.entries) {
        entry.analyser.getByteTimeDomainData(entry.data);
        let sum = 0;
        for (let i = 0; i < entry.data.length; i += 1) {
          const v = (entry.data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / entry.data.length);
        if (rms >= RMS_THRESHOLD) this.lastAbove.set(id, now);
        const active = now - (this.lastAbove.get(id) ?? 0) < SPEAKING_HOLD_MS;
        if (active && !this.speaking.has(id)) {
          this.speaking.add(id);
          changed = true;
        } else if (!active && this.speaking.has(id)) {
          this.speaking.delete(id);
          changed = true;
        }
      }
      if (changed) this.emit();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
