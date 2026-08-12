import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconBookmark,
  IconCopy,
  IconForward,
  IconPin,
  IconReply,
  IconSmile,
  IconTrash,
  IconUnread,
} from "./Icons";

export const QUICK_REACTIONS = ["✅", "⬆️", "❤️", "😂"] as const;

export type ContextMenuAction =
  | { type: "react"; emoji: string }
  | { type: "addReaction" }
  | { type: "reply" }
  | { type: "forward" }
  | { type: "copyText" }
  | { type: "pin" }
  | { type: "unpin" }
  | { type: "markUnread" }
  | { type: "bookmark" }
  | { type: "unbookmark" }
  | { type: "delete" }
  | { type: "copyId" };

interface Props {
  x: number;
  y: number;
  canDelete: boolean;
  canPin: boolean;
  pinned: boolean;
  bookmarked?: boolean;
  hasText: boolean;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

export function MessageContextMenu({
  x,
  y,
  canDelete,
  canPin,
  pinned,
  bookmarked = false,
  hasText,
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
    // Anchored to a click point, so any scroll or resize leaves it stranded.
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

  // In a portal so no transformed or scrolling ancestor can offset or clip it.
  return createPortal(
    <div
      ref={ref}
      className="msg-context-menu"
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}
      role="menu"
    >
      <div className="msg-context-reactions">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="msg-context-react-btn"
            onClick={() => onAction({ type: "react", emoji })}
          >
            {emoji}
          </button>
        ))}
      </div>

      <button type="button" className="msg-context-item" onClick={() => onAction({ type: "addReaction" })}>
        <IconSmile />
        Adicionar reação
      </button>
      <button type="button" className="msg-context-item" onClick={() => onAction({ type: "reply" })}>
        <IconReply />
        Responder
      </button>
      <button type="button" className="msg-context-item" onClick={() => onAction({ type: "forward" })}>
        <IconForward />
        Encaminhar
      </button>

      <div className="msg-context-sep" />

      {hasText && (
        <button type="button" className="msg-context-item" onClick={() => onAction({ type: "copyText" })}>
          <IconCopy />
          Copiar texto
        </button>
      )}
      {canPin && (
        <button
          type="button"
          className="msg-context-item"
          onClick={() => onAction({ type: pinned ? "unpin" : "pin" })}
        >
          <IconPin />
          {pinned ? "Desafixar mensagem" : "Fixar mensagem"}
        </button>
      )}

      <div className="msg-context-sep" />

      <button type="button" className="msg-context-item" onClick={() => onAction({ type: "markUnread" })}>
        <IconUnread />
        Marcar como não lido
      </button>
      <button
        type="button"
        className="msg-context-item"
        onClick={() => onAction({ type: bookmarked ? "unbookmark" : "bookmark" })}
      >
        <IconBookmark />
        {bookmarked ? "Remover dos salvos" : "Salvar pra mim"}
      </button>

      {canDelete && (
        <>
          <div className="msg-context-sep" />
          <button
            type="button"
            className="msg-context-item danger"
            onClick={() => onAction({ type: "delete" })}
          >
            <IconTrash />
            Excluir mensagem
          </button>
        </>
      )}

      <div className="msg-context-sep" />
      <button type="button" className="msg-context-item" onClick={() => onAction({ type: "copyId" })}>
        <IconCopy />
        Copiar ID da mensagem
      </button>
    </div>,
    document.body,
  );
}
