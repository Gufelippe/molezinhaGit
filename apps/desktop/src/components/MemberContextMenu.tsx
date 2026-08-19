import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconCopy,
  IconFriends,
  IconHeadphones,
  IconHeadphonesOff,
  IconMic,
  IconMicOff,
  IconSpeaker,
  IconUser,
} from "./Icons";

export type MemberMenuAction =
  | { type: "profile" }
  | { type: "message" }
  | { type: "addFriend" }
  | { type: "call" }
  | { type: "copyUser" }
  | { type: "kick" }
  | { type: "ban" }
  | { type: "serverMute"; muted: boolean }
  | { type: "serverDeafen"; deafened: boolean }
  | { type: "muteForMe" }
  | { type: "focus" }
  | { type: "fullscreen" };

type Props = {
  x: number;
  y: number;
  isSelf: boolean;
  isFriend: boolean;
  username?: string | null;
  inVoiceChannel: boolean;
  canModerate: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  showVolume?: boolean;
  volume?: number;
  onVolumeChange?: (value: number) => void;
  canFocus?: boolean;
  focused?: boolean;
  extra?: ReactNode;
  onAction: (action: MemberMenuAction) => void;
  onClose: () => void;
};

export function MemberContextMenu({
  x,
  y,
  isSelf,
  isFriend,
  username,
  inVoiceChannel,
  canModerate,
  serverMuted,
  serverDeafened,
  showVolume = false,
  volume = 1,
  onVolumeChange,
  canFocus = false,
  focused = false,
  extra,
  onAction,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  return createPortal(
    <div
      ref={ref}
      className="msg-context-menu"
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}
      role="menu"
    >
      <button type="button" className="msg-context-item" onClick={() => onAction({ type: "profile" })}>
        <IconUser />
        Ver perfil
      </button>
      {!isSelf && (
        <button
          type="button"
          className="msg-context-item"
          onClick={() => onAction({ type: isFriend ? "message" : "addFriend" })}
        >
          <IconFriends />
          {isFriend ? "Mensagem" : "Adicionar amigo"}
        </button>
      )}
      {!isSelf && inVoiceChannel && (
        <button type="button" className="msg-context-item" onClick={() => onAction({ type: "call" })}>
          <IconSpeaker />
          Chamar
        </button>
      )}
      {username && (
        <button type="button" className="msg-context-item" onClick={() => onAction({ type: "copyUser" })}>
          <IconCopy />
          Copiar @{username}
        </button>
      )}

      {showVolume && !isSelf && (
        <>
          <div className="msg-context-sep" />
          <div className="msg-context-volume" onMouseDown={(e) => e.stopPropagation()}>
            <span className="msg-context-volume-label">Volume desta pessoa</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              aria-label="Volume desta pessoa"
              onChange={(e) => onVolumeChange?.(Number(e.target.value) / 100)}
            />
          </div>
          <button type="button" className="msg-context-item" onClick={() => onAction({ type: "muteForMe" })}>
            <IconHeadphonesOff />
            Silenciar só pra mim
          </button>
        </>
      )}

      {canFocus && (
        <button type="button" className="msg-context-item" onClick={() => onAction({ type: "focus" })}>
          Ampliar
        </button>
      )}
      {extra}

      {canModerate && !isSelf && (
        <>
          <div className="msg-context-sep" />
          <button
            type="button"
            className="msg-context-item"
            onClick={() => onAction({ type: "serverMute", muted: !serverMuted })}
          >
            {serverMuted ? <IconMic /> : <IconMicOff />}
            {serverMuted ? "Desmutar no servidor" : "Mutar no servidor"}
          </button>
          <button
            type="button"
            className="msg-context-item"
            onClick={() => onAction({ type: "serverDeafen", deafened: !serverDeafened })}
          >
            {serverDeafened ? <IconHeadphones /> : <IconHeadphonesOff />}
            {serverDeafened ? "Ouvir no servidor" : "Ensurdecer no servidor"}
          </button>
          <button type="button" className="msg-context-item danger" onClick={() => onAction({ type: "kick" })}>
            Expulsar
          </button>
          <button type="button" className="msg-context-item danger" onClick={() => onAction({ type: "ban" })}>
            Banir
          </button>
        </>
      )}
    </div>,
    document.body
  );
}
