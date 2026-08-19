import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { MusicChannelState, Profile } from "@molezinha/shared";
import { callClient, isMusicPeerId, type RemotePeerMedia } from "../lib/calls";
import { useAuth } from "../lib/auth";
import { onVoiceSettingsChange, readVoiceSettings, applyAudioOutput } from "../lib/voiceSettings";
import { splitPresence } from "../lib/presence";
import {
  IconCollapse,
  IconExpand,
  IconFullscreen,
  IconFullscreenExit,
  IconHeadphonesOff,
  IconMic,
  IconMicOff,
  IconMusic,
  IconPhoneOff,
  IconScreen,
  IconVideo,
  IconVideoOff,
} from "./Icons";
import { Avatar } from "./Avatar";
import { NeoTooltip } from "./NeoTooltip";
import { MusicPanel } from "./MusicPanel";
import { MemberContextMenu, type MemberMenuAction } from "./MemberContextMenu";

interface Props {
  channelId: string;
  channelName: string;
  userId: string;
  isStaff: boolean;
  members: (Profile & { role?: string; server_muted?: boolean; server_deafened?: boolean })[];
  canModerateMember: (role?: string) => boolean;
  onLeave: () => void;
  onOpenProfile: (userId: string) => void;
  onVoiceModeration: (userId: string, muted: boolean, deafened: boolean) => void;
}

function kickRemoteAudioPlayback() {
  callClient.applyPeerVolumes();
  const settings = readVoiceSettings();
  const nodes = document.querySelectorAll<HTMLAudioElement>(".call-ui audio.call-remote-audio");
  for (const el of nodes) {
    if (!el.srcObject) continue;
    void applyAudioOutput(el, settings.outputDeviceId);
    void el.play().catch((err) => console.warn("[call] remote audio play failed", err));
  }
  void callClient.ensureOutgoingAudioAlive();
}

function formatElapsed(totalSeconds: number) {
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function CallBar({
  channelId,
  channelName,
  userId,
  isStaff,
  members,
  canModerateMember,
  onLeave,
  onOpenProfile,
  onVoiceModeration,
}: Props) {
  const { profile } = useAuth();
  const initial = callClient.getMediaState();
  const [muted, setMuted] = useState(initial.audioMuted);
  const [videoOn, setVideoOn] = useState(initial.videoEnabled);
  const [sharing, setSharing] = useState(initial.screenSharing);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(initial.screenStream);
  const [serverMuted, setServerMuted] = useState(initial.serverMuted);
  const [serverDeafened, setServerDeafened] = useState(initial.serverDeafened);
  const [busy, setBusy] = useState(false);
  const [peers, setPeers] = useState<Map<string, RemotePeerMedia>>(() => callClient.getPeersSnapshot());
  const [localStream, setLocalStream] = useState<MediaStream | null>(() => callClient.getLocalStream());
  const [status, setStatus] = useState<string | null>(null);
  const [musicState, setMusicState] = useState<MusicChannelState | null>(() =>
    callClient.getMusicState()
  );
  const [elapsed, setElapsed] = useState(0);
  const [focusedTile, setFocusedTile] = useState<string | null>(null);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    userId: string;
    peerId?: string;
    volume: boolean;
  } | null>(null);
  const [volumeTick, setVolumeTick] = useState(0);

  useEffect(() => callClient.onMusicState(setMusicState), []);
  useEffect(() => callClient.onSpeaking(setSpeakingIds), []);

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const unsub = callClient.onUpdate((nextPeers, local, media) => {
      setPeers(nextPeers);
      setLocalStream(local);
      setMuted(media.audioMuted);
      setVideoOn(media.videoEnabled);
      setSharing(media.screenSharing);
      setScreenStream(media.screenStream);
      setServerMuted(media.serverMuted);
      setServerDeafened(media.serverDeafened);
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

  async function toggleMute() {
    if (busy) return;
    if (!muted && (serverMuted || serverDeafened)) return;
    setBusy(true);
    setStatus(null);
    const next = !muted;
    try {
      await callClient.setAudioMuted(next);
      kickRemoteAudioPlayback();
    } catch {
      setStatus(
        serverMuted || serverDeafened
          ? "Seu microfone está mutado no servidor."
          : "Não foi possível alterar o microfone."
      );
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
      if (next) {
        await callClient.startScreenShare();
        const captured = callClient.getMediaState().screenStream;
        const hasAudio = captured?.getAudioTracks().some((t) => t.readyState === "live");
        if (captured && !hasAudio) {
          setStatus(
            "Tela compartilhada sem áudio. Marque «Compartilhar áudio do sistema» e escolha a tela inteira, não uma janela."
          );
        }
      } else {
        await callClient.stopScreenShare();
      }
    } catch {
      setStatus(next ? "Não foi possível compartilhar a tela." : "Não foi possível parar o compartilhamento.");
    } finally {
      setBusy(false);
    }
  }

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const peerList = [...peers.values()];
  const humanPeers = peerList
    .filter((p) => !isMusicPeerId(p.peerId))
    .map((peer) => {
      const live =
        peer.userId === userId ? profile : peer.userId ? memberById.get(peer.userId) : undefined;
      if (!live) return peer;
      return {
        ...peer,
        displayName: live.display_name || peer.displayName,
        avatarUrl: live.avatar_url,
      };
    });
  const musicPeers = peerList.filter((p) => isMusicPeerId(p.peerId));
  const screenPeers = humanPeers.filter((p) => p.screenStream);
  const selfName = profile?.display_name || "Você";

  function toggleFocus(key: string) {
    setFocusedTile((current) => (current === key ? null : key));
  }

  const openPeerMenu = useCallback(
    (e: MouseEvent, userId: string, peerId?: string, volume = true) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, userId, peerId, volume });
    },
    []
  );

  function memberFor(uid: string) {
    return members.find((m) => m.id === uid);
  }

  function handleMenuAction(action: MemberMenuAction) {
    if (!menu) return;
    const target = memberFor(menu.userId);
    const peer = menu.peerId ? peers.get(menu.peerId) : null;
    switch (action.type) {
      case "profile":
        onOpenProfile(menu.userId);
        break;
      case "muteForMe":
        callClient.mutePeerForMe(menu.userId);
        setVolumeTick((n) => n + 1);
        break;
      case "focus":
        if (menu.peerId) toggleFocus(menu.peerId);
        break;
      case "fullscreen":
        break;
      case "serverMute":
        onVoiceModeration(menu.userId, action.muted, Boolean(target?.server_deafened || peer?.serverDeafened));
        break;
      case "serverDeafen":
        onVoiceModeration(menu.userId, true, action.deafened);
        break;
      default:
        break;
    }
    setMenu(null);
  }

  const menuTarget = menu ? memberFor(menu.userId) : null;
  const menuPeer = menu?.peerId ? peers.get(menu.peerId) : null;
  void volumeTick;

  const tiles: CallTile[] = [];
  if (sharing && screenStream) {
    tiles.push({
      key: "local:screen",
      isScreen: true,
      render: (opts) => (
        <LocalScreenTile
          stream={screenStream}
          focused={opts.focused}
          allowFocus={opts.allowFocus}
          onToggleFocus={() => toggleFocus("local:screen")}
        />
      ),
    });
  }
  for (const peer of screenPeers) {
    const key = `${peer.peerId}:screen`;
    tiles.push({
      key,
      isScreen: true,
      render: (opts) => (
        <RemoteScreenTile
          peer={peer}
          focused={opts.focused}
          allowFocus={opts.allowFocus}
          onToggleFocus={() => toggleFocus(key)}
        />
      ),
    });
  }
  tiles.push({
    key: "local:cam",
    isScreen: false,
    render: (opts) => (
      <LocalCamTile
        stream={localStream}
        videoOn={videoOn}
        muted={muted || serverMuted}
        speaking={speakingIds.has(userId)}
        name={selfName}
        avatarUrl={profile?.avatar_url}
        userId={userId}
        focused={opts.focused}
        allowFocus={opts.allowFocus}
        onToggleFocus={() => toggleFocus("local:cam")}
      />
    ),
  });
  for (const peer of humanPeers) {
    tiles.push({
      key: peer.peerId,
      isScreen: false,
      render: (opts) => (
        <RemoteTile
          peer={peer}
          speaking={Boolean(peer.userId && speakingIds.has(peer.userId))}
          focused={opts.focused}
          allowFocus={opts.allowFocus}
          onToggleFocus={() => toggleFocus(peer.peerId)}
          onContextMenu={(e) => openPeerMenu(e, peer.userId, peer.peerId)}
        />
      ),
    });
  }

  // An explicit pick wins; otherwise shared screens claim the stage on their own.
  const focusedExists = tiles.some((t) => t.key === focusedTile);
  const staged = focusedExists
    ? tiles.filter((t) => t.key === focusedTile)
    : tiles.filter((t) => t.isScreen);
  const stagedKeys = new Set(staged.map((t) => t.key));
  const strip = tiles.filter((t) => !stagedKeys.has(t.key));
  const hasStage = staged.length > 0;
  const tileKeys = tiles.map((t) => t.key).join("|");

  useEffect(() => {
    if (focusedTile && !tileKeys.split("|").includes(focusedTile)) {
      setFocusedTile(null);
    }
  }, [focusedTile, tileKeys]);

  return (
    <div
      className={`call-ui${hasStage ? " call-ui-staged" : ""}`}
      onPointerDownCapture={() => {
        kickRemoteAudioPlayback();
      }}
    >
      {screenStream && <ScreenShareSink stream={screenStream} />}
      <div className="call-stage-row">
        <div className="call-media">
          {hasStage && (
            <div className="screen-stage">
              {staged.map((tile) => (
                <Fragment key={tile.key}>
                  {tile.render({
                    focused: focusedExists,
                    allowFocus: focusedExists || staged.length > 1 || !tile.isScreen,
                  })}
                </Fragment>
              ))}
            </div>
          )}
          {strip.length > 0 && (
            <div
              className={`video-grid ${hasStage ? "video-grid-strip" : ""}`}
              data-count={strip.length}
            >
              {strip.map((tile) => (
                <Fragment key={tile.key}>
                  {tile.render({ focused: false, allowFocus: true })}
                </Fragment>
              ))}
            </div>
          )}
          {/* Music bot is audio-only — keep a hidden player, no video tile. */}
          {musicPeers.map((peer) => (
            <MusicAudio key={peer.peerId} peer={peer} />
          ))}
          {/* Screen-share audio must live outside the tile: compact view can hide
              the strip, and a muted <video> never plays the captured track. */}
          {humanPeers
            .filter((peer) => peer.screenStream)
            .map((peer) => (
              <ScreenShareAudio key={`${peer.peerId}:screen-audio`} peer={peer} />
            ))}
        </div>

        <aside className="call-side" aria-label="Quem está na call">
          <section className="call-card call-roster">
            <header className="call-card-head">
              <span className="call-card-title">Na call</span>
              <span className="call-pill">{humanPeers.length + 1}</span>
            </header>
            <div className="call-roster-list">
              <div className={`call-roster-row ${speakingIds.has(userId) ? "speaking" : ""}`}>
                <Avatar
                  name={selfName}
                  url={profile?.avatar_url}
                  id={userId}
                  size="sm"
                  speaking={speakingIds.has(userId)}
                  {...(profile ? splitPresence(profile) : {})}
                />
                <span className="call-roster-name">Você</span>
                <span className="call-roster-flags">
                  {(muted || serverMuted) && (
                    <IconMicOff className={`icon call-roster-flag danger${serverMuted ? " server" : ""}`} />
                  )}
                  {serverDeafened && <IconHeadphonesOff className="icon call-roster-flag danger server" />}
                  {!videoOn && <IconVideoOff className="icon call-roster-flag off" />}
                  {sharing && <IconScreen className="icon call-roster-flag live" />}
                </span>
              </div>
              {humanPeers.map((peer) => (
                <div
                  className={`call-roster-row ${peer.userId && speakingIds.has(peer.userId) ? "speaking" : ""}`}
                  key={peer.peerId}
                  onContextMenu={(e) => openPeerMenu(e, peer.userId, peer.peerId)}
                >
                  <Avatar
                    name={peer.displayName}
                    url={peer.avatarUrl}
                    id={peer.userId || peer.peerId}
                    size="sm"
                    speaking={Boolean(peer.userId && speakingIds.has(peer.userId))}
                  />
                  <span className="call-roster-name">{peer.displayName}</span>
                  <span className="call-roster-flags">
                    {(peer.audioMuted || peer.serverMuted) && (
                      <IconMicOff className={`icon call-roster-flag danger${peer.serverMuted ? " server" : ""}`} />
                    )}
                    {peer.serverDeafened && (
                      <IconHeadphonesOff className="icon call-roster-flag danger server" />
                    )}
                    {peer.videoMuted && <IconVideoOff className="icon call-roster-flag off" />}
                    {peer.screenStream && <IconScreen className="icon call-roster-flag live" />}
                  </span>
                </div>
              ))}
              {musicPeers.map((peer) => (
                <div className="call-roster-row" key={peer.peerId}>
                  <span className="call-roster-bot">
                    <IconMusic />
                  </span>
                  <span className="call-roster-name">
                    {musicState?.nowPlaying?.title || peer.displayName}
                  </span>
                  <span className="call-roster-flags">
                    <IconMusic className="icon call-roster-flag live" />
                  </span>
                </div>
              ))}
            </div>
          </section>
          <MusicPanel channelId={channelId} userId={userId} isStaff={isStaff} />
        </aside>
      </div>

      {status && <p className="call-status">{status}</p>}
      {(serverMuted || serverDeafened) && (
        <p className="call-ctrl-hint">
          {serverDeafened
            ? "Você está ensurdecido no servidor — não dá para desmutar daqui."
            : "Seu microfone está mutado no servidor."}
        </p>
      )}
      <div className="call-bar">
        <div className="call-bar-id">
          <span className="call-live">
            <i aria-hidden />
            Ao vivo
          </span>
          <span className="call-bar-meta">
            #{channelName} · <time>{formatElapsed(elapsed)}</time>
          </span>
        </div>
        <div className="call-bar-actions">
          <NeoTooltip
            label={
              serverMuted || serverDeafened
                ? "Mutado no servidor"
                : muted
                  ? "Desmutar"
                  : "Mutar"
            }
            side="top"
          >
            <button
              className={`call-ctrl ${muted || serverMuted ? "call-ctrl-danger" : ""}`}
              type="button"
              disabled={busy || ((serverMuted || serverDeafened) && muted)}
              aria-pressed={muted || serverMuted}
              aria-label={muted ? "Desmutar microfone" : "Mutar microfone"}
              onClick={() => void toggleMute()}
            >
              {muted || serverMuted ? <IconMicOff /> : <IconMic />}
            </button>
          </NeoTooltip>
          <NeoTooltip label={videoOn ? "Desligar câmera" : "Ligar câmera"} side="top">
            <button
              className={`call-ctrl ${videoOn ? "call-ctrl-on" : ""}`}
              type="button"
              disabled={busy}
              aria-pressed={videoOn}
              aria-label={videoOn ? "Desligar câmera" : "Ligar câmera"}
              onClick={() => void toggleCamera()}
            >
              {videoOn ? <IconVideo /> : <IconVideoOff />}
            </button>
          </NeoTooltip>
          <NeoTooltip label={sharing ? "Parar de compartilhar" : "Compartilhar tela"} side="top">
            <button
              className={`call-ctrl ${sharing ? "call-ctrl-on" : ""}`}
              type="button"
              disabled={busy}
              aria-pressed={sharing}
              aria-label={sharing ? "Parar de compartilhar a tela" : "Compartilhar tela"}
              onClick={() => void toggleShare()}
            >
              <IconScreen />
            </button>
          </NeoTooltip>
        </div>
        <div className="call-bar-end">
          <button
            className="call-ctrl call-ctrl-leave"
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
      {menu && (
        <MemberContextMenu
          x={menu.x}
          y={menu.y}
          isSelf={menu.userId === userId}
          isFriend={false}
          username={menuTarget?.username}
          inVoiceChannel={false}
          canModerate={Boolean(menuTarget && canModerateMember(menuTarget.role))}
          serverMuted={Boolean(menuPeer?.serverMuted || menuTarget?.server_muted)}
          serverDeafened={Boolean(menuPeer?.serverDeafened || menuTarget?.server_deafened)}
          showVolume={menu.volume && menu.userId !== userId}
          volume={callClient.getPeerVolume(menu.userId)}
          onVolumeChange={(v) => {
            callClient.setPeerVolume(menu.userId, v);
            setVolumeTick((n) => n + 1);
          }}
          canFocus={Boolean(menu.peerId)}
          focused={menu.peerId === focusedTile}
          extra={
            <button
              type="button"
              className="msg-context-item"
              onClick={() => {
                const el = document.querySelector<HTMLElement>(
                  `[data-tile-key="${menu.peerId ?? ""}"]`
                );
                if (el) void el.requestFullscreen().catch(() => undefined);
                setMenu(null);
              }}
            >
              <IconFullscreen />
              Tela cheia
            </button>
          }
          onAction={handleMenuAction}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

type TileRenderOpts = {
  focused: boolean;
  /** Hide enlarge when a lone screen is already filling the stage. */
  allowFocus: boolean;
};

type CallTile = {
  key: string;
  /** Screen shares take the stage even when nothing is explicitly focused. */
  isScreen: boolean;
  render: (opts: TileRenderOpts) => ReactNode;
};

interface TileShellProps {
  focused: boolean;
  allowFocus: boolean;
  onToggleFocus: () => void;
  tag: ReactNode;
  screen?: boolean;
  off?: boolean;
  tileKey?: string;
  onContextMenu?: (e: MouseEvent) => void;
  children: ReactNode;
}

/** Tile chrome: the name tag plus the enlarge / fullscreen controls. */
function TileShell({
  focused,
  allowFocus,
  onToggleFocus,
  tag,
  screen,
  off,
  tileKey,
  onContextMenu,
  children,
}: TileShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  function toggleFullscreen() {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen().catch((err) => console.warn("[call] fullscreen failed", err));
    }
  }

  return (
    <div
      ref={ref}
      data-tile-key={tileKey}
      className={`video-tile${screen ? " video-tile-screen" : ""}${off ? " video-tile-off" : ""}`}
      onDoubleClick={toggleFullscreen}
      onContextMenu={onContextMenu}
    >
      {children}
      <span className="video-tile-tag">{tag}</span>
      <div className="video-tile-actions">
        {allowFocus && (
          <button
            className="tile-btn"
            type="button"
            title={focused ? "Voltar ao tamanho normal" : "Ampliar"}
            aria-label={focused ? "Voltar ao tamanho normal" : "Ampliar"}
            aria-pressed={focused}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFocus();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {focused ? <IconCollapse /> : <IconExpand />}
          </button>
        )}
        <button
          className="tile-btn"
          type="button"
          title={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          onClick={(e) => {
            e.stopPropagation();
            toggleFullscreen();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {fullscreen ? <IconFullscreenExit /> : <IconFullscreen />}
        </button>
      </div>
    </div>
  );
}

interface LocalCamTileProps {
  stream: MediaStream | null;
  videoOn: boolean;
  muted: boolean;
  speaking?: boolean;
  name: string;
  avatarUrl?: string | null;
  userId: string;
  focused: boolean;
  allowFocus: boolean;
  onToggleFocus: () => void;
}

function LocalCamTile({
  stream,
  videoOn,
  muted,
  speaking,
  name,
  avatarUrl,
  userId,
  focused,
  allowFocus,
  onToggleFocus,
}: LocalCamTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const live = videoOn && Boolean(stream?.getVideoTracks().some((t) => t.readyState === "live"));

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (live && stream) {
      el.srcObject = stream;
      void el.play().catch(() => undefined);
    } else {
      el.srcObject = null;
    }
  }, [stream, live]);

  return (
    <TileShell
      focused={focused}
      allowFocus={allowFocus}
      onToggleFocus={onToggleFocus}
      off={!live}
      tileKey="local:cam"
      tag={
        <>
          {muted ? (
            <IconMicOff className="icon video-tile-tag-icon danger" />
          ) : (
            <IconMic className="icon video-tile-tag-icon" />
          )}
          Você
        </>
      }
    >
      {live ? (
        <video className="video-tile-mirror" ref={videoRef} autoPlay muted playsInline />
      ) : (
        <div className="video-tile-placeholder">
          <Avatar name={name} url={avatarUrl} id={userId} size="xl" speaking={speaking} />
        </div>
      )}
    </TileShell>
  );
}

function LocalScreenTile({
  stream,
  focused,
  allowFocus,
  onToggleFocus,
}: {
  stream: MediaStream;
  focused: boolean;
  allowFocus: boolean;
  onToggleFocus: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
  }, [stream]);

  return (
    <TileShell
      screen
      focused={focused}
      allowFocus={allowFocus}
      onToggleFocus={onToggleFocus}
      tag={
        <>
          <IconScreen className="icon video-tile-tag-icon live" />
          Sua tela
        </>
      }
    >
      <video ref={videoRef} autoPlay muted playsInline />
    </TileShell>
  );
}

function ScreenShareAudio({ peer }: { peer: RemotePeerMedia }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const liveAudioTracks =
    peer.screenStream?.getAudioTracks().filter((t) => t.readyState === "live") ?? [];
  const audioTrackIds = liveAudioTracks.map((t) => t.id).join(",");

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (liveAudioTracks.length > 0) {
      el.srcObject = new MediaStream(liveAudioTracks);
      el.dataset.peerUser = peer.userId;
      callClient.applyPeerVolumes();
      void applyAudioOutput(el);
      void el.play().catch((err) => console.warn("[call] screen audio play failed", err));
    } else {
      el.srcObject = null;
    }
  }, [peer.screenStream, audioTrackIds, peer.userId]);

  useEffect(() => {
    return onVoiceSettingsChange((s) => {
      const el = audioRef.current;
      if (!el) return;
      callClient.applyPeerVolumes();
      void applyAudioOutput(el, s.outputDeviceId);
    });
  }, []);

  return (
    <audio
      ref={audioRef}
      className="call-remote-audio"
      data-peer-user={peer.userId}
      autoPlay
      playsInline
      aria-hidden
    />
  );
}

function ScreenShareSink({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
  }, [stream]);

  // Must stay mounted and not `display:none` while sharing. Chromium ends a
  // getDisplayMedia track when no element is rendering it.
  return (
    <video
      ref={ref}
      className="call-screen-sink"
      autoPlay
      muted
      playsInline
      aria-hidden
    />
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

function RemoteTile({
  peer,
  speaking,
  focused,
  allowFocus,
  onToggleFocus,
  onContextMenu,
}: {
  peer: RemotePeerMedia;
  speaking?: boolean;
  focused: boolean;
  allowFocus: boolean;
  onToggleFocus: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
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
      el.dataset.peerUser = peer.userId;
      callClient.applyPeerVolumes();
      void applyAudioOutput(el);
      void el.play().catch((err) => console.warn("[call] remote audio play failed", err));
    } else {
      el.srcObject = null;
    }
  }, [peer.stream, audioTrackIds, peer.userId]);

  useEffect(() => {
    return onVoiceSettingsChange((s) => {
      const el = audioRef.current;
      if (!el) return;
      callClient.applyPeerVolumes();
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
    <TileShell
      focused={focused}
      allowFocus={allowFocus}
      onToggleFocus={onToggleFocus}
      off={!hasLiveVideo}
      tileKey={peer.peerId}
      onContextMenu={onContextMenu}
      tag={
        <>
          {peer.audioMuted || peer.serverMuted ? (
            <IconMicOff className="icon video-tile-tag-icon danger" />
          ) : (
            <IconMic className="icon video-tile-tag-icon" />
          )}
          {peer.displayName}
          {peer.screenStream && <IconScreen className="icon video-tile-tag-icon live" />}
        </>
      }
    >
      <audio
        ref={audioRef}
        className="call-remote-audio"
        data-peer-user={peer.userId}
        autoPlay
        playsInline
      />
      {hasLiveVideo ? (
        <video ref={videoRef} autoPlay playsInline muted />
      ) : (
        <div className="video-tile-placeholder">
          <Avatar
            name={peer.displayName}
            url={peer.avatarUrl}
            id={peer.userId || peer.peerId}
            size="xl"
            speaking={speaking}
          />
        </div>
      )}
    </TileShell>
  );
}

function RemoteScreenTile({
  peer,
  focused,
  allowFocus,
  onToggleFocus,
}: {
  peer: RemotePeerMedia;
  focused: boolean;
  allowFocus: boolean;
  onToggleFocus: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const screen = peer.screenStream;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const videoTracks = screen?.getVideoTracks().filter((t) => t.readyState === "live") ?? [];
    if (videoTracks.length > 0) {
      el.srcObject = new MediaStream(videoTracks);
      void el.play().catch((err) => console.warn("[call] remote screen play failed", err));
    } else {
      el.srcObject = null;
    }
  }, [screen]);

  if (!screen) return null;

  return (
    <TileShell
      screen
      focused={focused}
      allowFocus={allowFocus}
      onToggleFocus={onToggleFocus}
      tag={
        <>
          <IconScreen className="icon video-tile-tag-icon live" />
          Tela de {peer.displayName}
        </>
      }
    >
      <video ref={videoRef} autoPlay playsInline muted />
    </TileShell>
  );
}
