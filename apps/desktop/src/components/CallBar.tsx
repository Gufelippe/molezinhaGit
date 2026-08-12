import { useEffect, useRef, useState } from "react";
import type { MusicChannelState } from "@molezinha/shared";
import { callClient, isMusicPeerId, type RemotePeerMedia } from "../lib/calls";
import { onVoiceSettingsChange, readVoiceSettings, applyAudioOutput } from "../lib/voiceSettings";
import {
  IconMic,
  IconMicOff,
  IconMusic,
  IconPhoneOff,
  IconScreen,
  IconVideo,
  IconVideoOff,
} from "./Icons";
import { MusicPanel } from "./MusicPanel";

interface Props {
  channelId: string;
  channelName: string;
  userId: string;
  isStaff: boolean;
  onLeave: () => void;
}

function getOutputVolume() {
  return readVoiceSettings().outputVolume;
}

/** WebView2 often blocks autoplay until a click — re-kick all remote <audio>. */
function kickRemoteAudioPlayback() {
  const settings = readVoiceSettings();
  const musicVolume = callClient.getMusicVolume();
  const nodes = document.querySelectorAll<HTMLAudioElement>(".call-ui audio.call-remote-audio");
  for (const el of nodes) {
    if (!el.srcObject) continue;
    el.muted = false;
    el.volume = el.classList.contains("call-music-audio") ? musicVolume : settings.outputVolume;
    void applyAudioOutput(el, settings.outputDeviceId);
    void el.play().catch((err) => console.warn("[call] remote audio play failed", err));
  }
}

function initialOf(name: string) {
  return (name || "?")[0]?.toUpperCase() ?? "?";
}

export function CallBar({ channelId, channelName, userId, isStaff, onLeave }: Props) {
  const initial = callClient.getMediaState();
  const [muted, setMuted] = useState(initial.audioMuted);
  const [videoOn, setVideoOn] = useState(initial.videoEnabled);
  const [sharing, setSharing] = useState(initial.screenSharing);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(initial.screenStream);
  const [busy, setBusy] = useState(false);
  const [peers, setPeers] = useState<Map<string, RemotePeerMedia>>(() => callClient.getPeersSnapshot());
  const [localStream, setLocalStream] = useState<MediaStream | null>(() => callClient.getLocalStream());
  const [status, setStatus] = useState<string | null>(null);
  const [musicState, setMusicState] = useState<MusicChannelState | null>(() =>
    callClient.getMusicState()
  );
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localScreenRef = useRef<HTMLVideoElement>(null);

  useEffect(() => callClient.onMusicState(setMusicState), []);

  useEffect(() => {
    const unsub = callClient.onUpdate((nextPeers, local, media) => {
      setPeers(nextPeers);
      setLocalStream(local);
      setMuted(media.audioMuted);
      setVideoOn(media.videoEnabled);
      setSharing(media.screenSharing);
      setScreenStream(media.screenStream);
      queueMicrotask(() => kickRemoteAudioPlayback());
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    return onVoiceSettingsChange(() => {
      kickRemoteAudioPlayback();
    });
  }, []);

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (videoOn && localStream?.getVideoTracks().some((t) => t.readyState === "live")) {
      el.srcObject = localStream;
      void el.play().catch(() => undefined);
    } else {
      el.srcObject = null;
    }
  }, [localStream, videoOn]);

  useEffect(() => {
    const el = localScreenRef.current;
    if (!el) return;
    if (sharing && screenStream) {
      el.srcObject = screenStream;
      void el.play().catch(() => undefined);
    } else {
      el.srcObject = null;
    }
  }, [screenStream, sharing]);

  async function toggleMute() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    const next = !muted;
    try {
      await callClient.setAudioMuted(next);
      kickRemoteAudioPlayback();
    } catch {
      setStatus("Não foi possível alterar o microfone.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCamera() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    const next = !videoOn;
    try {
      await callClient.setVideoEnabled(next);
      kickRemoteAudioPlayback();
    } catch {
      setStatus(next ? "Não foi possível ligar a câmera." : "Não foi possível desligar a câmera.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleShare() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    const next = !sharing;
    try {
      if (next) await callClient.startScreenShare();
      else await callClient.stopScreenShare();
    } catch {
      setStatus(next ? "Não foi possível compartilhar a tela." : "Não foi possível parar o compartilhamento.");
    } finally {
      setBusy(false);
    }
  }

  const peerList = [...peers.values()];
  const humanPeers = peerList.filter((p) => !isMusicPeerId(p.peerId));
  const musicPeers = peerList.filter((p) => isMusicPeerId(p.peerId));
  const screenPeers = humanPeers.filter((p) => p.screenStream);
  // A shared screen takes the stage; cameras drop to a strip so no tile is starved.
  const hasStage = sharing || screenPeers.length > 0;

  return (
    <div
      className="call-ui"
      onPointerDownCapture={() => {
        kickRemoteAudioPlayback();
      }}
    >
      <div className="call-stage-row">
        <div className="call-media">
          {hasStage && (
            <div className="screen-stage">
              {sharing && (
                <div className="video-tile video-tile-screen">
                  <video ref={localScreenRef} autoPlay muted playsInline />
                  <span className="label">Sua tela</span>
                </div>
              )}
              {screenPeers.map((peer) => (
                <RemoteScreenTile key={`${peer.peerId}:screen`} peer={peer} />
              ))}
            </div>
          )}
          <div className={`video-grid ${hasStage ? "video-grid-strip" : ""}`}>
            <div className={`video-tile ${videoOn ? "" : "video-tile-off"}`}>
              {videoOn ? (
                <video ref={localVideoRef} autoPlay muted playsInline />
              ) : (
                <div className="video-tile-placeholder">Câmera off</div>
              )}
              <span className="label">
                Você{muted ? " · mudo" : ""}
              </span>
            </div>
            {humanPeers.map((peer) => (
              <RemoteTile key={peer.peerId} peer={peer} />
            ))}
            {/* Music bot is audio-only — keep a hidden player, no video tile. */}
            {musicPeers.map((peer) => (
              <MusicAudio key={peer.peerId} peer={peer} />
            ))}
          </div>
        </div>

        <aside className="call-roster" aria-label="Quem está na call">
          <div className="call-roster-title">Na call — {humanPeers.length + 1}</div>
          <div className="call-roster-list">
            <div className="call-roster-row">
              <div className="call-roster-avatar">Vc</div>
              <span className="call-roster-name">Você</span>
              <span className="call-roster-flags">
                {muted && <IconMicOff className="icon call-roster-flag danger" />}
                {!videoOn && <IconVideoOff className="icon call-roster-flag off" />}
                {sharing && <IconScreen className="icon call-roster-flag live" />}
              </span>
            </div>
            {humanPeers.map((peer) => (
              <div className="call-roster-row" key={peer.peerId}>
                <div className="call-roster-avatar">{initialOf(peer.displayName)}</div>
                <span className="call-roster-name">{peer.displayName}</span>
                <span className="call-roster-flags">
                  {peer.audioMuted && <IconMicOff className="icon call-roster-flag danger" />}
                  {peer.videoMuted && <IconVideoOff className="icon call-roster-flag off" />}
                  {peer.screenStream && <IconScreen className="icon call-roster-flag live" />}
                </span>
              </div>
            ))}
            {musicPeers.map((peer) => (
              <div className="call-roster-row" key={peer.peerId}>
                <div className="call-roster-avatar call-roster-avatar-music">
                  <IconMusic />
                </div>
                <span className="call-roster-name">
                  {musicState?.nowPlaying?.title || peer.displayName}
                </span>
                <span className="call-roster-flags">
                  <IconMusic className="icon call-roster-flag live" />
                </span>
              </div>
            ))}
          </div>
          <MusicPanel channelId={channelId} userId={userId} isStaff={isStaff} />
        </aside>
      </div>

      {status && <p className="muted call-status">{status}</p>}
      <div className="call-bar">
        <div className="call-bar-id">
          <strong className="call-bar-channel">#{channelName}</strong>
          <span className="muted call-bar-count">{peers.size + 1} na call</span>
        </div>
        <div className="stack-row call-bar-actions">
          <button
            className={`neo-btn ${muted ? "neo-btn-danger" : ""}`}
            type="button"
            disabled={busy}
            onClick={() => void toggleMute()}
          >
            {muted ? <IconMicOff /> : <IconMic />}
            {muted ? "Desmutar" : "Mutar"}
          </button>
          <button
            className={`neo-btn ${videoOn ? "" : "neo-btn-danger"}`}
            type="button"
            disabled={busy}
            aria-pressed={videoOn}
            onClick={() => void toggleCamera()}
          >
            {videoOn ? <IconVideo /> : <IconVideoOff />}
            {videoOn ? "Desligar câmera" : "Ligar câmera"}
          </button>
          <button
            className={`neo-btn ${sharing ? "neo-btn-primary" : ""}`}
            type="button"
            disabled={busy}
            aria-pressed={sharing}
            onClick={() => void toggleShare()}
          >
            <IconScreen />
            {sharing ? "Parar tela" : "Compartilhar tela"}
          </button>
          <button
            className="neo-btn neo-btn-danger"
            type="button"
            disabled={busy}
            onClick={() => {
              void callClient.leave();
              onLeave();
            }}
          >
            <IconPhoneOff />
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

function MusicAudio({ peer }: { peer: RemotePeerMedia }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const liveAudioTracks = peer.stream.getAudioTracks().filter((t) => t.readyState === "live");
  const audioTrackIds = liveAudioTracks.map((t) => t.id).join(",");

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (liveAudioTracks.length > 0) {
      el.srcObject = new MediaStream(liveAudioTracks);
      el.muted = false;
      el.volume = callClient.getMusicVolume();
      void applyAudioOutput(el);
      void el.play().catch((err) => console.warn("[call] music audio play failed", err));
    } else {
      el.srcObject = null;
    }
  }, [peer.stream, audioTrackIds]);

  useEffect(() => {
    return onVoiceSettingsChange((s) => {
      const el = audioRef.current;
      if (!el) return;
      void applyAudioOutput(el, s.outputDeviceId);
    });
  }, []);

  return (
    <audio
      ref={audioRef}
      className="call-remote-audio call-music-audio"
      autoPlay
      playsInline
      aria-hidden
    />
  );
}

function RemoteTile({ peer }: { peer: RemotePeerMedia }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hasLiveVideo =
    !peer.videoMuted && peer.stream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled);
  const liveAudioTracks = peer.stream.getAudioTracks().filter((t) => t.readyState === "live");
  const audioTrackIds = liveAudioTracks.map((t) => t.id).join(",");

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (liveAudioTracks.length > 0) {
      el.srcObject = new MediaStream(liveAudioTracks);
      el.muted = false;
      el.volume = getOutputVolume();
      void applyAudioOutput(el);
      void el.play().catch((err) => console.warn("[call] remote audio play failed", err));
    } else {
      el.srcObject = null;
    }
  }, [peer.stream, audioTrackIds]);

  useEffect(() => {
    return onVoiceSettingsChange((s) => {
      const el = audioRef.current;
      if (!el) return;
      el.volume = s.outputVolume;
      void applyAudioOutput(el, s.outputDeviceId);
    });
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (hasLiveVideo) {
      const videoTracks = peer.stream.getVideoTracks().filter((t) => t.readyState === "live" && t.enabled);
      el.srcObject = new MediaStream(videoTracks);
      void el.play().catch((err) => console.warn("[call] remote video play failed", err));
    } else {
      el.srcObject = null;
    }
  }, [peer.stream, hasLiveVideo, peer.videoMuted]);

  return (
    <div className={`video-tile ${hasLiveVideo ? "" : "video-tile-off"}`}>
      <audio ref={audioRef} className="call-remote-audio" autoPlay playsInline />
      {hasLiveVideo ? (
        <video ref={videoRef} autoPlay playsInline muted />
      ) : (
        <div className="video-tile-placeholder">{peer.displayName[0]?.toUpperCase() ?? "?"}</div>
      )}
      <span className="label">
        {peer.displayName}
        {peer.audioMuted ? " · mudo" : ""}
        {peer.videoMuted || !hasLiveVideo ? " · cam off" : ""}
      </span>
    </div>
  );
}

function RemoteScreenTile({ peer }: { peer: RemotePeerMedia }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const screen = peer.screenStream;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (screen) {
      el.srcObject = screen;
      void el.play().catch((err) => console.warn("[call] remote screen play failed", err));
    } else {
      el.srcObject = null;
    }
  }, [screen]);

  if (!screen) return null;

  return (
    <div className="video-tile video-tile-screen">
      <video ref={videoRef} autoPlay playsInline muted />
      <span className="label">Tela de {peer.displayName}</span>
    </div>
  );
}
