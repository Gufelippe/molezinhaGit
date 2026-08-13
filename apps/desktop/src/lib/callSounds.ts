import { readVoiceSettings } from "./voiceSettings";

type AudioContextWithSink = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

let context: AudioContextWithSink | null = null;

function getContext() {
  context ??= new AudioContext() as AudioContextWithSink;
  return context;
}

async function configureOutput(ctx: AudioContextWithSink) {
  const settings = readVoiceSettings();
  if (settings.outputDeviceId && ctx.setSinkId) {
    await ctx.setSinkId(settings.outputDeviceId).catch(() => undefined);
  }
  await ctx.resume().catch(() => undefined);
  return settings.outputVolume;
}

/**
 * Call this directly from the user gesture that starts a call. WebView2 may
 * otherwise keep the AudioContext suspended after the async join handshake.
 */
export function unlockCallSounds() {
  try {
    void configureOutput(getContext());
  } catch {
    /* Sound feedback must never block joining a call. */
  }
}

function playChime(notes: readonly number[], descending = false) {
  try {
    const ctx = getContext();
    void configureOutput(ctx).then((outputVolume) => {
      if (outputVolume <= 0) return;

      const start = ctx.currentTime + 0.015;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, start);
      master.gain.exponentialRampToValueAtTime(0.13 * outputVolume, start + 0.025);
      master.gain.exponentialRampToValueAtTime(
        0.0001,
        start + notes.length * 0.085 + 0.18
      );
      master.connect(ctx.destination);

      notes.forEach((frequency, index) => {
        const noteStart = start + index * 0.085;
        const oscillator = ctx.createOscillator();
        const envelope = ctx.createGain();
        oscillator.type = index === 0 ? "sine" : "triangle";
        oscillator.frequency.setValueAtTime(frequency, noteStart);
        if (descending) {
          oscillator.frequency.exponentialRampToValueAtTime(
            frequency * 0.97,
            noteStart + 0.18
          );
        }
        envelope.gain.setValueAtTime(0.0001, noteStart);
        envelope.gain.exponentialRampToValueAtTime(0.9, noteStart + 0.018);
        envelope.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.2);
        oscillator.connect(envelope);
        envelope.connect(master);
        oscillator.start(noteStart);
        oscillator.stop(noteStart + 0.21);
      });

      window.setTimeout(() => master.disconnect(), 700);
    });
  } catch {
    /* Call state is more important than optional sound feedback. */
  }
}

/** Soft ascending chime used for both local and remote joins. */
export function playCallJoinSound() {
  playChime([523.25, 659.25, 783.99]);
}

/** Short descending chime used for both local and remote leaves. */
export function playCallLeaveSound() {
  playChime([659.25, 493.88, 392], true);
}
