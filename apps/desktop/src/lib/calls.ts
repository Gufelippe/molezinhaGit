import type { types as msTypes } from "mediasoup-client";
import type { CallServerMessage, MediaSource, MusicChannelState } from "@molezinha/shared";
import { CALLS_URL } from "./supabase";
import {
  playCallJoinSound,
  playCallLeaveSound,
  unlockCallSounds,
} from "./callSounds";
import { createVoiceChain, type VoiceChain } from "./audioChain";
import { SpeakingMonitor } from "./speaking";
import {
  applyVoiceProcessing,
  buildAudioConstraints,
  buildDisplayMediaOptions,
  buildVideoConstraints,
  onVoiceSettingsChange,
  readVoiceSettings,
  videoBitrate,
  type VoiceSettings,
} from "./voiceSettings";

type MsDevice = import("mediasoup-client").Device;

export interface RemotePeerMedia {
  peerId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  /** Mic + camera tracks. */
  stream: MediaStream;
  /** Screen share video + optional system/tab audio, when the peer is sharing. */
  screenStream: MediaStream | null;
  audioMuted: boolean;
  videoMuted: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
}

type MediaState = {
  audioMuted: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  screenStream: MediaStream | null;
  serverMuted: boolean;
  serverDeafened: boolean;
};

type Listener = (
  peers: Map<string, RemotePeerMedia>,
  localStream: MediaStream | null,
  media: MediaState
) => void;

type MusicListener = (state: MusicChannelState | null) => void;
type SpeakingListener = (ids: Set<string>) => void;

const PEER_VOLUME_KEY = "molezinha.peerVolume";

function loadPeerVolumes(): Map<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(PEER_VOLUME_KEY) || "{}") as Record<string, unknown>;
    const map = new Map<string, number>();
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        map.set(id, Math.min(1, Math.max(0, value)));
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function savePeerVolumes(map: Map<string, number>) {
  const obj: Record<string, number> = {};
  for (const [id, value] of map) obj[id] = value;
  localStorage.setItem(PEER_VOLUME_KEY, JSON.stringify(obj));
}

export function isMusicPeerId(peerId: string) {
  return peerId.startsWith("music:");
}

export class CallClient {
  private ws: WebSocket | null = null;
  private device: MsDevice | null = null;
  private sendTransport: msTypes.Transport | null = null;
  private recvTransport: msTypes.Transport | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private audioProducer: msTypes.Producer | null = null;
  private videoProducer: msTypes.Producer | null = null;
  private screenProducer: msTypes.Producer | null = null;
  private screenAudioProducer: msTypes.Producer | null = null;
  private peers = new Map<string, RemotePeerMedia>();
  private peerNames = new Map<string, string>();
  private peerUserIds = new Map<string, string>();
  private peerAvatars = new Map<string, string | null>();
  private pending = new Map<string, (msg: CallServerMessage) => void>();
  private listeners = new Set<Listener>();
  private musicListeners = new Set<MusicListener>();
  private speakingListeners = new Set<SpeakingListener>();
  private speaking = new SpeakingMonitor();
  private peerVolumes = loadPeerVolumes();
  private voiceModeration = new Map<string, { muted: boolean; deafened: boolean }>();
  private musicState: MusicChannelState | null = null;
  private musicVolume = 0.8;
  private channelId: string | null = null;
  private localUserId: string | null = null;
  private localPeerIds = new Set<string>();
  private joinGeneration = 0;
  private joinLock: Promise<void> = Promise.resolve();
  private audioMuted = false;
  private videoEnabled = false;
  private serverMuted = false;
  private serverDeafened = false;
  private leaving = false;
  /** Producers that arrived before recv transport was ready */
  private pendingConsumes: Array<{
    peerId: string;
    producerId: string;
    kind: "audio" | "video";
    source: MediaSource;
  }> = [];
  private consumedProducers = new Set<string>();
  private consumers = new Map<string, msTypes.Consumer>();
  /** producerId → capture it came from, so screen tracks land on the right stream */
  private remoteSources = new Map<string, MediaSource>();
  private voiceChain: VoiceChain | null = null;
  private rawMicTrack: MediaStreamTrack | null = null;
  /** Constraints the live mic capture was opened with. */
  private appliedCapture: {
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
  } | null = null;
  /** Settings the current processing chain was built from. */
  private appliedChain: Pick<
    VoiceSettings,
    "noiseSuppression" | "noiseGate" | "inputGain"
  > | null = null;
  private unsubVoiceSettings: (() => void) | null = null;

  constructor() {
    this.unsubVoiceSettings = onVoiceSettingsChange((s) => {
      void this.applyLiveVoiceSettings(s);
      this.applyPeerVolumes();
    });
    this.speaking.onChange((ids) => {
      for (const fn of this.speakingListeners) fn(ids);
    });
  }

  onUpdate(fn: Listener) {
    this.listeners.add(fn);
    // Push current state immediately — join often finishes before CallBar mounts.
    fn(new Map(this.peers), this.localStream, this.getMediaState());
    return () => {
      this.listeners.delete(fn);
    };
  }

  onMusicState(fn: MusicListener) {
    this.musicListeners.add(fn);
    fn(this.musicState);
    return () => {
      this.musicListeners.delete(fn);
    };
  }

  onSpeaking(fn: SpeakingListener) {
    this.speakingListeners.add(fn);
    fn(this.speaking.current());
    return () => {
      this.speakingListeners.delete(fn);
    };
  }

  getPeerVolume(userId: string) {
    return this.peerVolumes.get(userId) ?? 1;
  }

  setPeerVolume(userId: string, volume: number) {
    const next = Math.min(1, Math.max(0, volume));
    this.peerVolumes.set(userId, next);
    savePeerVolumes(this.peerVolumes);
    this.applyPeerVolumes();
  }

  mutePeerForMe(userId: string) {
    this.setPeerVolume(userId, 0);
  }

  isLocalServerMuted() {
    return this.serverMuted || this.serverDeafened;
  }

  isLocalServerDeafened() {
    return this.serverDeafened;
  }

  sendServerVoiceModeration(userId: string, muted: boolean, deafened: boolean) {
    this.send({ type: "serverVoiceModeration", userId, muted, deafened });
  }

  applyPeerVolumes() {
    const nodes = document.querySelectorAll<HTMLAudioElement>("audio.call-remote-audio");
    for (const el of nodes) {
      if (el.classList.contains("call-music-audio")) continue;
      const userId = el.dataset.peerUser;
      const peerVol = userId ? this.getPeerVolume(userId) : 1;
      const settingsVol = readVoiceSettings().outputVolume;
      el.volume = Math.min(1, settingsVol * peerVol);
      el.muted = this.serverDeafened || peerVol <= 0;
    }
  }

  getMusicState() {
    return this.musicState;
  }

  getMusicVolume() {
    return this.musicVolume;
  }

  setMusicVolume(volume: number) {
    this.musicVolume = Math.min(1, Math.max(0, volume));
    this.applyMusicVolume();
  }

  private applyMusicVolume() {
    const nodes = document.querySelectorAll<HTMLAudioElement>("audio.call-music-audio");
    for (const el of nodes) {
      el.volume = this.musicVolume;
    }
  }

  private emitMusic() {
    for (const fn of this.musicListeners) fn(this.musicState);
  }

  getPeersSnapshot() {
    return new Map(this.peers);
  }

  getLocalStream() {
    return this.localStream;
  }

  getScreenStream() {
    return this.screenStream;
  }

  private emit() {
    const media = this.getMediaState();
    for (const fn of this.listeners) fn(new Map(this.peers), this.localStream, media);
    this.syncSpeaking();
    queueMicrotask(() => this.applyPeerVolumes());
  }

  private rememberPeer(info: {
    peerId: string;
    userId?: string;
    displayName?: string;
    avatarUrl?: string | null;
  }) {
    if (info.displayName) this.peerNames.set(info.peerId, info.displayName);
    if (info.userId) this.peerUserIds.set(info.peerId, info.userId);
    if (info.avatarUrl !== undefined) this.peerAvatars.set(info.peerId, info.avatarUrl ?? null);
  }

  private emptyPeer(peerId: string, extras?: Partial<RemotePeerMedia>): RemotePeerMedia {
    const userId = extras?.userId ?? this.peerUserIds.get(peerId) ?? "";
    const mod = this.voiceModeration.get(userId);
    return {
      peerId,
      userId,
      displayName: extras?.displayName ?? this.peerNames.get(peerId) ?? "Amigo",
      avatarUrl: extras?.avatarUrl ?? this.peerAvatars.get(peerId) ?? null,
      stream: extras?.stream ?? new MediaStream(),
      screenStream: extras?.screenStream ?? null,
      audioMuted: extras?.audioMuted ?? false,
      videoMuted: extras?.videoMuted ?? true,
      serverMuted: extras?.serverMuted ?? Boolean(mod?.muted),
      serverDeafened: extras?.serverDeafened ?? Boolean(mod?.deafened),
    };
  }

  private applyVoiceModeration(userId: string, muted: boolean, deafened: boolean) {
    this.voiceModeration.set(userId, { muted, deafened });
    if (this.localUserId && userId === this.localUserId) {
      this.serverMuted = muted;
      this.serverDeafened = deafened;
      if ((muted || deafened) && !this.audioMuted) {
        void this.setAudioMuted(true).catch(() => undefined);
      }
    }
    for (const [peerId, peer] of this.peers) {
      if (peer.userId !== userId) continue;
      this.peers.set(peerId, {
        ...peer,
        serverMuted: muted,
        serverDeafened: deafened,
        audioMuted: muted || deafened ? true : peer.audioMuted,
      });
    }
    this.emit();
  }

  private syncSpeaking() {
    const keep = new Set<string>();
    if (this.localUserId && this.localStream) {
      keep.add(this.localUserId);
      void this.speaking.attach(this.localUserId, this.localStream);
    }
    for (const peer of this.peers.values()) {
      if (!peer.userId || isMusicPeerId(peer.peerId)) continue;
      keep.add(peer.userId);
      void this.speaking.attach(peer.userId, peer.stream);
    }
    this.speaking.keep(keep);
  }

  getMediaState(): MediaState {
    return {
      audioMuted: this.audioMuted,
      videoEnabled: this.videoEnabled,
      screenSharing: Boolean(this.screenProducer && !this.screenProducer.closed),
      screenStream: this.screenStream,
      serverMuted: this.serverMuted,
      serverDeafened: this.serverDeafened,
    };
  }

  private waitFor<T extends CallServerMessage["type"]>(
    type: T,
    match?: (msg: Extract<CallServerMessage, { type: T }>) => boolean
  ): Promise<Extract<CallServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const id = `${type}:${crypto.randomUUID()}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${type}`));
      }, 15000);

      this.pending.set(id, (msg) => {
        if (msg.type !== type) return;
        if (match && !match(msg as Extract<CallServerMessage, { type: T }>)) return;
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(msg as Extract<CallServerMessage, { type: T }>);
      });
    });
  }

  private handleMessage(msg: CallServerMessage) {
    for (const cb of this.pending.values()) cb(msg);

    if (msg.type === "error") {
      console.error("[call]", msg.message);
      return;
    }

    if (msg.type === "peerJoined") {
      if (this.localUserId && msg.peer.userId === this.localUserId) {
        this.localPeerIds.add(msg.peer.peerId);
        return;
      }
      this.rememberPeer(msg.peer);
      if (!this.peers.has(msg.peer.peerId)) {
        this.peers.set(
          msg.peer.peerId,
          this.emptyPeer(msg.peer.peerId, {
            userId: msg.peer.userId,
            displayName: msg.peer.displayName,
            avatarUrl: msg.peer.avatarUrl,
          })
        );
        this.emit();
        if (!isMusicPeerId(msg.peer.peerId)) playCallJoinSound();
      }
      return;
    }

    if (msg.type === "peerLeft") {
      const wasHumanPeer =
        this.peers.has(msg.peerId) && !isMusicPeerId(msg.peerId);
      this.localPeerIds.delete(msg.peerId);
      this.peers.delete(msg.peerId);
      this.peerNames.delete(msg.peerId);
      this.emit();
      if (wasHumanPeer) playCallLeaveSound();
      return;
    }

    if (msg.type === "newProducer") {
      if (this.localPeerIds.has(msg.peerId)) return;
      void this.consumeProducer(
        msg.peerId,
        msg.producerId,
        msg.kind,
        msg.appData?.source ?? (msg.kind === "audio" ? "mic" : "camera")
      );
      return;
    }

    if (msg.type === "producerClosed") {
      const source = this.remoteSources.get(msg.producerId);
      this.remoteSources.delete(msg.producerId);
      const consumer = this.consumers.get(msg.producerId);
      if (consumer) {
        try {
          consumer.close();
        } catch {
          /* ignore */
        }
        this.consumers.delete(msg.producerId);
        this.consumedProducers.delete(msg.producerId);
        const peer = this.peers.get(msg.peerId);
        if (peer) {
          const target = source === "screen" ? peer.screenStream : peer.stream;
          try {
            target?.removeTrack(consumer.track);
          } catch {
            /* ignore */
          }
          try {
            consumer.track.stop();
          } catch {
            /* ignore */
          }
          this.refreshPeerStreams(peer);
          this.peers.set(msg.peerId, { ...peer });
          this.emit();
        }
        return;
      }
      const peer = this.peers.get(msg.peerId);
      if (!peer) return;
      for (const stream of [peer.stream, peer.screenStream]) {
        if (!stream) continue;
        for (const track of [...stream.getTracks()]) {
          if (track.readyState === "ended") {
            stream.removeTrack(track);
            track.stop();
          }
        }
      }
      this.refreshPeerStreams(peer);
      this.peers.set(msg.peerId, { ...peer });
      this.emit();
      return;
    }

    if (msg.type === "peerMute") {
      const peer = this.peers.get(msg.peerId);
      if (!peer) return;
      if (msg.kind === "audio") peer.audioMuted = msg.muted;
      if (msg.kind === "video") peer.videoMuted = msg.muted;
      this.emit();
      return;
    }

    if (msg.type === "musicState") {
      this.musicState = msg.state;
      this.emitMusic();
      queueMicrotask(() => this.applyMusicVolume());
    }

    if (msg.type === "serverVoiceModeration") {
      this.applyVoiceModeration(msg.userId, msg.muted, msg.deafened);
    }

    if (msg.type === "joined" && msg.voiceModeration) {
      for (const row of msg.voiceModeration) {
        this.applyVoiceModeration(row.userId, row.muted, row.deafened);
      }
    }
  }

  /** Rebuild stream identities (React needs new refs) and recompute video state. */
  private refreshPeerStreams(peer: RemotePeerMedia) {
    peer.videoMuted = !peer.stream.getVideoTracks().some((t) => t.readyState === "live");
    peer.stream = new MediaStream(peer.stream.getTracks());
    const screenTracks =
      peer.screenStream?.getTracks().filter((t) => t.readyState === "live") ?? [];
    peer.screenStream = screenTracks.length ? new MediaStream(screenTracks) : null;
  }

  private send(payload: unknown) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.warn("[call] send failed", err);
    }
  }

  private clearPending() {
    this.pending.clear();
  }

  async join(
    channelId: string,
    token: string,
    opts: { audio: boolean; video: boolean; muteOnJoin: boolean; userId: string }
  ) {
    unlockCallSounds();
    const run = async () => {
      await this.leaveInternal();
      this.channelId = channelId;
      this.localUserId = opts.userId;
      this.localPeerIds.clear();
      const generation = ++this.joinGeneration;

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(CALLS_URL);
        this.ws = ws;

        const fail = (message: string) => {
          if (this.joinGeneration !== generation) return;
          reject(new Error(message));
        };

        ws.onopen = () => {
          if (this.joinGeneration !== generation || this.ws !== ws) return;
          resolve();
        };
        ws.onerror = () => fail("Falha ao conectar no servidor de calls");
        ws.onclose = () => {
          if (this.joinGeneration === generation && this.ws === ws) {
            this.ws = null;
          }
        };
        ws.onmessage = (ev) => {
          if (this.joinGeneration !== generation) return;
          try {
            this.handleMessage(JSON.parse(String(ev.data)) as CallServerMessage);
          } catch {
            /* ignore */
          }
        };
      });

      if (this.joinGeneration !== generation) {
        throw new Error("Entrada na call cancelada");
      }

      const joinedPromise = this.waitFor("joined");
      this.send({ type: "join", channelId, token });
      const joined = await joinedPromise;

      if (this.joinGeneration !== generation) {
        throw new Error("Entrada na call cancelada");
      }

      for (const p of joined.peers) {
        if (p.userId === opts.userId) {
          this.localPeerIds.add(p.peerId);
          continue;
        }
        this.rememberPeer(p);
        if (!this.peers.has(p.peerId)) {
          this.peers.set(
            p.peerId,
            this.emptyPeer(p.peerId, {
              userId: p.userId,
              displayName: p.displayName,
              avatarUrl: p.avatarUrl,
            })
          );
        }
      }
      if (joined.voiceModeration) {
        for (const row of joined.voiceModeration) {
          this.applyVoiceModeration(row.userId, row.muted, row.deafened);
        }
      }
      this.emit();

      const { Device } = await import("mediasoup-client");
      this.device = new Device();
      await this.device.load({
        routerRtpCapabilities: joined.routerRtpCapabilities as msTypes.RtpCapabilities,
      });

      this.sendTransport = await this.createTransport("send");
      this.recvTransport = await this.createTransport("recv");
      await this.flushPendingConsumes();

      this.audioMuted = false;
      this.videoEnabled = false;

      // Privacy: never open the camera on join — only mic unless video is explicitly requested.
      const micId = await this.resolveStoredMicId();
      const camId = localStorage.getItem("molezinha.cam") || undefined;
      const constraints: MediaStreamConstraints = {};
      if (opts.audio) {
        constraints.audio = buildAudioConstraints(micId);
      }
      if (opts.video) constraints.video = buildVideoConstraints(camId);
      if (!constraints.audio && !constraints.video) {
        throw new Error("Nada para capturar na call");
      }

      const capture = await navigator.mediaDevices.getUserMedia(constraints);
      const audioTracks: MediaStreamTrack[] = [];
      if (opts.audio) {
        const raw = capture.getAudioTracks()[0];
        if (raw) {
          const processed = await this.setupMicTrack(raw);
          audioTracks.push(processed);
        }
      }
      const videoTracks = opts.video ? capture.getVideoTracks() : [];
      // Stop unused capture tracks (e.g. video when audio-only)
      if (!opts.video) {
        for (const t of capture.getVideoTracks()) {
          t.stop();
        }
      }
      this.localStream = new MediaStream([...audioTracks, ...videoTracks]);

      if (this.joinGeneration !== generation) {
        this.teardownAudioPipeline();
        this.localStream.getTracks().forEach((t) => t.stop());
        this.localStream = null;
        throw new Error("Entrada na call cancelada");
      }

      if (opts.audio) {
        const track = this.localStream.getAudioTracks()[0];
        this.audioProducer = await this.sendTransport.produce({
          track,
          appData: { source: "mic" },
        });
        if (opts.muteOnJoin || this.serverMuted || this.serverDeafened) {
          await this.audioProducer.pause();
          track.enabled = false;
          this.audioMuted = true;
          this.send({ type: "mute", kind: "audio", muted: true });
        }
        // Join handshake is async — the RNNoise context may have parked itself.
        queueMicrotask(() => {
          void this.ensureOutgoingAudioAlive();
        });
      }

      if (opts.video) {
        const track = this.localStream.getVideoTracks()[0];
        if (track) {
          this.videoProducer = await this.produceVideo(track, "camera");
          this.videoEnabled = true;
        }
      }

      for (const peer of joined.peers) {
        if (peer.userId === opts.userId) continue;
        for (const producer of peer.producers) {
          await this.consumeProducer(
            peer.peerId,
            producer.id,
            producer.kind,
            producer.appData?.source ?? (producer.kind === "audio" ? "mic" : "camera")
          );
        }
      }

      this.emit();
      playCallJoinSound();
    };

    const next = this.joinLock.then(run, run);
    this.joinLock = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /** Wraps a fresh mic capture in the processing chain and adopts it. */
  private async setupMicTrack(
    raw: MediaStreamTrack,
    settings: VoiceSettings = readVoiceSettings()
  ): Promise<MediaStreamTrack> {
    this.teardownAudioPipeline();
    this.rawMicTrack = raw;
    this.appliedCapture = {
      noiseSuppression: settings.noiseSuppression !== "off",
      echoCancellation: settings.echoCancellation,
      autoGainControl: settings.autoGainControl,
    };
    return (await this.buildVoiceChain(raw, settings)) ?? raw;
  }

  private async buildVoiceChain(raw: MediaStreamTrack, settings: VoiceSettings) {
    this.appliedChain = {
      noiseSuppression: settings.noiseSuppression,
      noiseGate: settings.noiseGate,
      inputGain: settings.inputGain,
    };
    try {
      this.voiceChain = await createVoiceChain(raw, settings);
    } catch (err) {
      // A broken worklet must never cost the user their microphone.
      console.warn("[call] processamento de áudio indisponível", err);
      this.voiceChain = null;
    }
    return this.voiceChain?.track ?? null;
  }

  private closeVoiceChain() {
    try {
      this.voiceChain?.close();
    } catch {
      /* ignore */
    }
    this.voiceChain = null;
    this.appliedChain = null;
  }

  private teardownAudioPipeline() {
    this.closeVoiceChain();
    this.appliedCapture = null;
    if (this.rawMicTrack) {
      try {
        this.rawMicTrack.stop();
      } catch {
        /* ignore */
      }
    }
    this.rawMicTrack = null;
  }

  async applyLiveVoiceSettings(settings: VoiceSettings = readVoiceSettings()) {
    const capture = this.appliedCapture;
    const captureChanged =
      !capture ||
      capture.noiseSuppression !== (settings.noiseSuppression !== "off") ||
      capture.echoCancellation !== settings.echoCancellation ||
      capture.autoGainControl !== settings.autoGainControl;
    const chain = this.appliedChain;
    // Gain is a live parameter; the suppressor and the gate are wired at build
    // time, so changing them means rebuilding the graph (but not the capture).
    const chainChanged =
      !chain ||
      chain.noiseSuppression !== settings.noiseSuppression ||
      chain.noiseGate !== settings.noiseGate ||
      (chain.inputGain !== settings.inputGain && !this.voiceChain);

    if (this.rawMicTrack && captureChanged) {
      await this.restartMicTrack(settings);
    } else if (this.rawMicTrack && chainChanged) {
      await this.rebuildVoiceChain(settings);
    } else if (this.voiceChain && chain) {
      this.voiceChain.setGain(settings.inputGain);
      chain.inputGain = settings.inputGain;
    }

    await this.applyVideoBitrate(this.videoProducer, "camera", settings);
    await this.applyVideoBitrate(this.screenProducer, "screen", settings);
  }

  /**
   * Chromium locks noise suppression / echo cancellation / AGC at capture time —
   * `applyConstraints` on a live track is a no-op, so re-capture and swap the track.
   */
  /**
   * Drop a stale `molezinha.mic` id (reinstalled drivers / unplugged headset)
   * so we don't soft-pick a silent virtual device via `{ ideal }`.
   */
  private async resolveStoredMicId(): Promise<string | undefined> {
    const stored = localStorage.getItem("molezinha.mic") || "";
    if (!stored) return undefined;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const stillThere = devices.some(
        (d) => d.kind === "audioinput" && d.deviceId === stored
      );
      if (stillThere) return stored;
      localStorage.removeItem("molezinha.mic");
      console.warn("[call] microfone salvo sumiu — usando o padrão do sistema");
    } catch {
      /* keep stored id; getUserMedia will soft-fail via ideal */
    }
    return undefined;
  }

  /**
   * WebView2 parks AudioContexts without a gesture. Call this from UI clicks
   * so a suspended RNNoise graph starts producing samples again — or swap back
   * to the raw mic if resume is impossible.
   */
  async ensureOutgoingAudioAlive() {
    const chain = this.voiceChain;
    if (!chain) return;
    if (chain.isLive()) return;
    const resumed = await chain.resume();
    if (resumed) return;
    const raw = this.rawMicTrack;
    const producer = this.audioProducer;
    if (!raw || raw.readyState !== "live" || !producer || producer.closed) return;
    console.warn("[call] cadeia de voz muda — enviando o microfone cru");
    try {
      chain.close();
    } catch {
      /* ignore */
    }
    this.voiceChain = null;
    this.appliedChain = null;
    raw.enabled = !this.audioMuted;
    try {
      await producer.replaceTrack({ track: raw });
    } catch (err) {
      console.warn("[call] replaceTrack (fallback mic) failed", err);
      return;
    }
    const otherTracks = this.localStream?.getTracks().filter((t) => t.kind !== "audio") ?? [];
    this.localStream = new MediaStream([raw, ...otherTracks]);
    this.emit();
  }

  private async restartMicTrack(settings: VoiceSettings) {
    const producer = this.audioProducer;
    const micId = await this.resolveStoredMicId();

    let capture: MediaStream;
    try {
      capture = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(micId, settings),
      });
    } catch (err) {
      console.warn("[call] mic re-capture failed", err);
      // Keep the current track alive and at least try the (best effort) live update.
      if (this.rawMicTrack) await applyVoiceProcessing(this.rawMicTrack, settings);
      return;
    }

    const raw = capture.getAudioTracks()[0];
    if (!raw) return;

    const previousAudio = this.localStream?.getAudioTracks() ?? [];
    const outgoing = await this.setupMicTrack(raw, settings);
    outgoing.enabled = !this.audioMuted;

    if (producer && !producer.closed) {
      try {
        await producer.replaceTrack({ track: outgoing });
      } catch (err) {
        console.warn("[call] replaceTrack failed", err);
      }
    }

    for (const old of previousAudio) {
      if (old === outgoing) continue;
      try {
        old.stop();
      } catch {
        /* ignore */
      }
    }

    const otherTracks = this.localStream?.getTracks().filter((t) => t.kind !== "audio") ?? [];
    this.localStream = new MediaStream([outgoing, ...otherTracks]);
    this.emit();
  }

  /**
   * Swaps the processing graph while keeping the same capture, so toggling the
   * suppressor mid-call doesn't drop a word.
   */
  private async rebuildVoiceChain(settings: VoiceSettings) {
    const raw = this.rawMicTrack;
    if (!raw) return;
    const producer = this.audioProducer;
    const previous = this.voiceChain;
    this.voiceChain = null;

    const outgoing = (await this.buildVoiceChain(raw, settings)) ?? raw;
    outgoing.enabled = !this.audioMuted;

    if (producer && !producer.closed) {
      try {
        await producer.replaceTrack({ track: outgoing });
      } catch (err) {
        console.warn("[call] replaceTrack failed", err);
      }
    }

    try {
      previous?.close();
    } catch {
      /* ignore */
    }

    const otherTracks = this.localStream?.getTracks().filter((t) => t.kind !== "audio") ?? [];
    this.localStream = new MediaStream([outgoing, ...otherTracks]);
    this.emit();
  }

  private async applyVideoBitrate(
    producer: msTypes.Producer | null,
    source: "camera" | "screen",
    settings: VoiceSettings
  ) {
    if (!producer || producer.closed) return;
    try {
      await producer.setRtpEncodingParameters({
        maxBitrate: videoBitrate(source, settings),
      });
    } catch (err) {
      console.warn("[call] setRtpEncodingParameters failed", err);
    }
  }

  private async produceVideo(track: MediaStreamTrack, source: "camera" | "screen") {
    if (!this.sendTransport) throw new Error("Call ainda não está pronta");
    return this.sendTransport.produce({
      track,
      encodings: [{ maxBitrate: videoBitrate(source) }],
      codecOptions: { videoGoogleStartBitrate: 400 },
      appData: { source },
    });
  }

  private async produceScreenAudio(track: MediaStreamTrack) {
    if (!this.sendTransport) throw new Error("Call ainda não está pronta");
    return this.sendTransport.produce({
      track,
      codecOptions: { opusStereo: true, opusFec: true },
      appData: { source: "screen" as const },
    });
  }

  private closeLocalProducer(producer: msTypes.Producer | null) {
    if (!producer || producer.closed) return;
    const producerId = producer.id;
    try {
      producer.close();
    } catch {
      /* ignore */
    }
    this.send({ type: "closeProducer", producerId });
  }

  private async createTransport(direction: "send" | "recv") {
    const createdPromise = this.waitFor(
      "transportCreated",
      (m) => m.direction === direction
    );
    this.send({ type: "createWebRtcTransport", direction });
    const created = await createdPromise;

    const transport =
      direction === "send"
        ? this.device!.createSendTransport({
            id: created.id,
            iceParameters: created.iceParameters as msTypes.IceParameters,
            iceCandidates: created.iceCandidates as msTypes.IceCandidate[],
            dtlsParameters: created.dtlsParameters as msTypes.DtlsParameters,
          })
        : this.device!.createRecvTransport({
            id: created.id,
            iceParameters: created.iceParameters as msTypes.IceParameters,
            iceCandidates: created.iceCandidates as msTypes.IceCandidate[],
            dtlsParameters: created.dtlsParameters as msTypes.DtlsParameters,
          });

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      const connected = this.waitFor(
        "transportConnected",
        (m) => m.transportId === transport.id
      );
      this.send({
        type: "connectWebRtcTransport",
        transportId: transport.id,
        dtlsParameters,
      });
      connected.then(() => callback()).catch(errback);
    });

    if (direction === "send") {
      transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
        const source = (appData as { source?: MediaSource } | undefined)?.source;
        // Camera and screen are both video — match the echoed source too.
        // Servers that don't echo appData fall back to matching on kind alone.
        const produced = this.waitFor(
          "produced",
          (m) => m.kind === kind && (m.appData?.source ?? source) === source
        );
        this.send({
          type: "produce",
          transportId: transport.id,
          kind,
          rtpParameters,
          appData,
        });
        produced
          .then((msg) => callback({ id: msg.id }))
          .catch(errback);
      });
    }

    return transport;
  }

  private async flushPendingConsumes() {
    const pending = this.pendingConsumes.splice(0, this.pendingConsumes.length);
    for (const item of pending) {
      await this.consumeProducer(item.peerId, item.producerId, item.kind, item.source);
    }
  }

  private async consumeProducer(
    peerId: string,
    producerId: string,
    kind: "audio" | "video",
    source: MediaSource
  ) {
    if (!this.recvTransport || !this.device) {
      if (!this.pendingConsumes.some((p) => p.producerId === producerId)) {
        this.pendingConsumes.push({ peerId, producerId, kind, source });
      }
      return;
    }
    if (this.consumedProducers.has(producerId) || this.localPeerIds.has(peerId)) return;

    this.consumedProducers.add(producerId);
    try {
      const consumedPromise = this.waitFor(
        "consumed",
        (m) => m.producerId === producerId
      );
      this.send({
        type: "consume",
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      });
      const consumed = await consumedPromise;

      const consumer = await this.recvTransport.consume({
        id: consumed.id,
        producerId: consumed.producerId,
        kind: consumed.kind,
        rtpParameters: consumed.rtpParameters as msTypes.RtpParameters,
      });

      this.consumers.set(producerId, consumer);
      this.send({ type: "resumeConsumer", consumerId: consumer.id });
      try {
        await consumer.resume();
      } catch (err) {
        console.warn("[call] consumer.resume failed", err);
      }

      // Trust the server echo — appData is authoritative for who owns the track.
      let resolvedSource = consumed.appData?.source ?? source;

      // Display capture survives as `displaySurface` on some Chromium tracks,
      // even when an older peer omitted appData.source.
      if (kind === "video" && resolvedSource !== "screen") {
        const settings = consumer.track.getSettings() as MediaTrackSettings & {
          displaySurface?: string;
        };
        if (settings.displaySurface) resolvedSource = "screen";
      }

      // Older clients publish without appData. A peer only ever has one camera,
      // so a second live video track can only be a screen share.
      if (kind === "video" && resolvedSource !== "screen") {
        const existing = this.peers.get(peerId);
        const hasCamera = existing?.stream
          .getVideoTracks()
          .some((t) => t.readyState === "live");
        if (hasCamera) resolvedSource = "screen";
      }

      // Same idea for screen audio: mic is already on `peer.stream`, so a second
      // live audio track from a peer who is sharing is the display capture.
      if (kind === "audio" && resolvedSource !== "screen" && resolvedSource !== "music") {
        const existing = this.peers.get(peerId);
        const hasMic = existing?.stream
          .getAudioTracks()
          .some((t) => t.readyState === "live");
        const hasScreenVideo = existing?.screenStream
          ?.getVideoTracks()
          .some((t) => t.readyState === "live");
        if (hasMic && hasScreenVideo) resolvedSource = "screen";
      }
      if (!consumed.appData?.source) {
        console.warn(
          "[call] producer without appData.source — peer or server is outdated",
          { peerId, kind, assumed: resolvedSource }
        );
      }
      this.remoteSources.set(producerId, resolvedSource);

      let peer = this.peers.get(peerId);
      if (!peer) {
        peer = this.emptyPeer(peerId, {
          videoMuted: kind !== "audio",
        });
        this.peers.set(peerId, peer);
      }
      if (resolvedSource === "screen") {
        if (!peer.screenStream) peer.screenStream = new MediaStream();
        peer.screenStream.addTrack(consumer.track);
        peer.screenStream = new MediaStream(peer.screenStream.getTracks());
      } else {
        peer.stream.addTrack(consumer.track);
        if (kind === "video") peer.videoMuted = false;
        // new stream identity for React consumers
        peer.stream = new MediaStream(peer.stream.getTracks());
      }
      this.peers.set(peerId, { ...peer });
      this.emit();
    } catch (err) {
      this.consumedProducers.delete(producerId);
      this.consumers.delete(producerId);
      console.warn("[call] consumeProducer failed", producerId, kind, err);
    }
  }

  async setAudioMuted(muted: boolean) {
    if (!muted && (this.serverMuted || this.serverDeafened)) {
      throw new Error("Seu microfone está mutado no servidor");
    }
    if (!this.audioProducer) {
      this.audioMuted = muted;
      this.emit();
      return;
    }
    try {
      if (muted) await this.audioProducer.pause();
      else await this.audioProducer.resume();
      const track = this.localStream?.getAudioTracks()[0];
      if (track) track.enabled = !muted;
      this.audioMuted = muted;
      this.send({ type: "mute", kind: "audio", muted });
      this.emit();
    } catch (err) {
      console.warn("[call] setAudioMuted failed", err);
      throw err;
    }
  }

  async setVideoEnabled(enabled: boolean) {
    try {
      if (!enabled) {
        if (this.videoProducer && !this.videoProducer.closed) {
          await this.videoProducer.pause();
        }
        const track = this.localStream?.getVideoTracks()[0];
        if (track) {
          track.enabled = false;
          track.stop();
          this.localStream?.removeTrack(track);
          // new MediaStream so React/UI picks up the change
          if (this.localStream) {
            this.localStream = new MediaStream(this.localStream.getTracks());
          }
        }
        if (this.videoProducer && !this.videoProducer.closed) {
          const producerId = this.videoProducer.id;
          this.videoProducer.close();
          this.send({ type: "closeProducer", producerId });
        }
        this.videoProducer = null;
        this.videoEnabled = false;
        this.send({ type: "mute", kind: "video", muted: true });
        this.emit();
        return;
      }

      // enable camera
      if (this.videoProducer && !this.videoProducer.closed) {
        const existing = this.localStream?.getVideoTracks()[0];
        if (existing && existing.readyState === "live") {
          existing.enabled = true;
          await this.videoProducer.resume();
          this.videoEnabled = true;
          this.send({ type: "mute", kind: "video", muted: false });
          this.emit();
          return;
        }
        this.videoProducer.close();
        this.videoProducer = null;
      }

      if (!this.sendTransport) {
        throw new Error("Call ainda não está pronta");
      }

      const camId = localStorage.getItem("molezinha.cam") || undefined;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(camId),
      });
      const videoTrack = stream.getVideoTracks()[0];
      const audioTracks = this.localStream?.getAudioTracks() ?? [];
      this.localStream = new MediaStream([...audioTracks, videoTrack]);
      this.videoProducer = await this.produceVideo(videoTrack, "camera");
      this.videoEnabled = true;
      this.send({ type: "mute", kind: "video", muted: false });
      this.emit();
    } catch (err) {
      this.videoEnabled = false;
      this.emit();
      console.warn("[call] setVideoEnabled failed", err);
      throw err;
    }
  }

  get screenSharing() {
    return Boolean(this.screenProducer && !this.screenProducer.closed);
  }

  /** Capture a screen / window and publish video plus optional system/tab audio. */
  async startScreenShare() {
    if (this.screenSharing) return;
    if (!this.sendTransport) throw new Error("Call ainda não está pronta");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaOptions());
    } catch (err) {
      // Extra Chromium fields (`systemAudio`) can throw on some WebViews.
      // Retry with a plain audio+video request before giving up.
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: buildDisplayMediaOptions().video,
          audio: true,
        });
      } catch (retryErr) {
        if (retryErr instanceof DOMException && retryErr.name === "NotAllowedError") return;
        throw retryErr;
      }
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Nenhuma tela selecionada");
    }
    // Prioritise sharpness over frame rate for text-heavy screens.
    if ("contentHint" in track) track.contentHint = "detail";
    // The OS "stop sharing" control ends the track outside our UI.
    track.addEventListener("ended", () => {
      void this.stopScreenShare();
    });
    this.screenStream = stream;
    try {
      this.screenProducer = await this.produceVideo(track, "screen");
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      this.emit();
      throw err;
    }
    await this.produceScreenAudioFrom(stream);
    this.emit();
  }

  private async produceScreenAudioFrom(stream: MediaStream) {
    const audioTrack = stream.getAudioTracks().find((t) => t.readyState === "live");
    if (!audioTrack || !this.sendTransport) return;
    if ("contentHint" in audioTrack) audioTrack.contentHint = "music";
    try {
      await audioTrack.applyConstraints({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      });
    } catch {
      /* some capture surfaces reject these */
    }
    audioTrack.addEventListener("ended", () => {
      this.closeLocalProducer(this.screenAudioProducer);
      this.screenAudioProducer = null;
    });
    try {
      this.screenAudioProducer = await this.produceScreenAudio(audioTrack);
    } catch (err) {
      console.warn("[call] screen audio produce failed", err);
    }
  }

  async stopScreenShare() {
    const videoProducer = this.screenProducer;
    const audioProducer = this.screenAudioProducer;
    this.screenProducer = null;
    this.screenAudioProducer = null;
    const stream = this.screenStream;
    this.screenStream = null;
    this.closeLocalProducer(videoProducer);
    this.closeLocalProducer(audioProducer);
    stream?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    this.emit();
  }

  async leave() {
    if (this.leaving) return;
    this.leaving = true;
    const wasInCall = Boolean(this.channelId);
    if (wasInCall) playCallLeaveSound();
    this.joinGeneration += 1;
    try {
      await this.leaveInternal();
    } finally {
      this.leaving = false;
    }
  }

  private async leaveInternal() {
    this.clearPending();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "leave" }));
        } catch {
          /* ignore */
        }
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.audioProducer?.close();
    this.videoProducer?.close();
    this.screenProducer?.close();
    this.screenAudioProducer?.close();
    for (const consumer of this.consumers.values()) {
      try {
        consumer.close();
      } catch {
        /* ignore */
      }
    }
    this.consumers.clear();
    this.consumedProducers.clear();
    this.remoteSources.clear();
    this.pendingConsumes = [];
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.teardownAudioPipeline();
    this.audioProducer = null;
    this.videoProducer = null;
    this.screenProducer = null;
    this.screenAudioProducer = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.peers.clear();
    this.peerNames.clear();
    this.peerUserIds.clear();
    this.peerAvatars.clear();
    this.voiceModeration.clear();
    this.speaking.close();
    this.channelId = null;
    this.localUserId = null;
    this.localPeerIds.clear();
    this.audioMuted = false;
    this.videoEnabled = false;
    this.serverMuted = false;
    this.serverDeafened = false;
    this.musicState = null;
    this.emitMusic();
    this.releaseMediaDevices();
    this.emit();
  }

  /** Stop any lingering mic/cam tracks (e.g. after crash / HMR). Safe to call anytime. */
  releaseMediaDevices() {
    const stream = this.localStream;
    this.localStream = null;
    const screen = this.screenStream;
    this.screenStream = null;
    for (const s of [stream, screen]) {
      s?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
    }
    this.teardownAudioPipeline();
    this.videoEnabled = false;
    this.screenProducer = null;
    this.screenAudioProducer = null;
  }

  get activeChannelId() {
    return this.channelId;
  }
}

export const callClient = new CallClient();
