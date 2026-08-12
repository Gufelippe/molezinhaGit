import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message, Profile, Sticker } from "@molezinha/shared";
import type { PendingAttachment } from "../lib/chatCache";
import {
  MEDIA_LIMITS,
  readImageDimensions,
  validateImageFile,
} from "../lib/mediaLimits";
import {
  IconClose,
  IconPaperclip,
  IconPoll,
  IconSend,
  IconSmile,
  IconSticker,
} from "./Icons";
import { EmojiPicker } from "./EmojiPicker";
import { StickerPicker } from "./StickerPicker";
import { NeoTooltip } from "./NeoTooltip";

export type MentionCandidate = Pick<Profile, "id" | "username" | "display_name" | "avatar_url">;

const MAX_ATTACHMENTS = 4;
/** Placeholder body so attachment-only messages satisfy the non-empty content check. */
export const ATTACHMENT_ONLY_CONTENT = "📎";

interface Props {
  placeholder: string;
  mentionCandidates?: MentionCandidate[];
  replyTo?: Message | null;
  disabled?: boolean;
  disabledHint?: string;
  onCancelReply?: () => void;
  onSend: (
    content: string,
    mentionedUserIds: string[],
    replyToId?: string | null,
    attachments?: PendingAttachment[]
  ) => void;
  onSendSticker: (sticker: Sticker, replyToId?: string | null) => void;
  onTyping?: () => void;
  onCreatePoll?: () => void;
  onError?: (message: string) => void;
}

function extractMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
  if (!m) return null;
  const query = m[2] ?? "";
  const start = before.length - query.length - 1;
  return { start, query };
}

/** Owns draft locally so typing does not re-render the whole app shell. */
export const ChatComposer = memo(function ChatComposer({
  placeholder,
  mentionCandidates = [],
  replyTo,
  disabled = false,
  disabledHint,
  onCancelReply,
  onSend,
  onSendSticker,
  onTyping,
  onCreatePoll,
  onError,
}: Props) {
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingAttachment[]>([]);

  pendingRef.current = pending;

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo?.id]);

  useEffect(() => {
    return () => {
      for (const p of pendingRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  const reportError = useCallback(
    (message: string) => {
      setLocalError(message);
      onError?.(message);
      window.setTimeout(() => setLocalError(null), 4000);
    },
    [onError]
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (disabled || !files.length) return;
      const room = MAX_ATTACHMENTS - pendingRef.current.length;
      if (room <= 0) {
        reportError(`Máximo de ${MAX_ATTACHMENTS} anexos por mensagem.`);
        return;
      }
      const accepted: PendingAttachment[] = [];
      for (const file of files.slice(0, room)) {
        const check = await validateImageFile(file, "attachment");
        if (!check.ok) {
          reportError(`${file.name}: ${check.message}`);
          continue;
        }
        const dims = await readImageDimensions(file);
        accepted.push({
          file,
          previewUrl: URL.createObjectURL(file),
          width: dims?.width ?? null,
          height: dims?.height ?? null,
        });
      }
      if (accepted.length) setPending((prev) => [...prev, ...accepted]);
    },
    [disabled, reportError]
  );

  function removePending(index: number) {
    setPending((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  const filteredMentions = useMemo(() => {
    if (!mentionOpen || !mentionCandidates.length) return [];
    const q = mentionQuery.toLowerCase();
    return mentionCandidates
      .filter(
        (m) =>
          m.username.toLowerCase().includes(q) ||
          m.display_name.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [mentionOpen, mentionQuery, mentionCandidates]);

  function syncMentionState(value: string, caret: number) {
    if (!mentionCandidates.length) {
      setMentionOpen(false);
      return;
    }
    const hit = extractMentionQuery(value, caret);
    if (!hit) {
      setMentionOpen(false);
      return;
    }
    setMentionOpen(true);
    setMentionQuery(hit.query);
    setMentionStart(hit.start);
    setMentionIndex(0);
  }

  function pickMention(m: MentionCandidate) {
    const before = draft.slice(0, mentionStart);
    const afterCaret = inputRef.current?.selectionStart ?? draft.length;
    const after = draft.slice(afterCaret);
    const inserted = `@${m.username} `;
    const next = before + inserted + after;
    setDraft(next);
    setMentionIds((ids) => (ids.includes(m.id) ? ids : [...ids, m.id]));
    setMentionOpen(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const pos = before.length + inserted.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function submit() {
    if (disabled) return;
    const content = draft.trim();
    const attachments = pending;
    if (!content && !attachments.length) return;
    const ids = mentionIds.filter((id) => {
      const user = mentionCandidates.find((c) => c.id === id);
      return user ? content.toLowerCase().includes(`@${user.username.toLowerCase()}`) : false;
    });
    const replyId = replyTo?.id ?? null;
    setDraft("");
    setMentionIds([]);
    setPending([]);
    setEmojiOpen(false);
    setMentionOpen(false);
    onSend(
      content || ATTACHMENT_ONLY_CONTENT,
      ids,
      replyId,
      attachments.length ? attachments : undefined
    );
  }

  const canSubmit = !disabled && (Boolean(draft.trim()) || pending.length > 0);

  return (
    <div
      className={`composer ${dragging ? "composer-dragging" : ""}`}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) void addFiles(files);
      }}
    >
      {replyTo && (
        <div className="composer-reply-chip">
          <div className="composer-reply-chip-body">
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              Respondendo a
            </span>
            <strong>{replyTo.profiles?.display_name ?? "Alguém"}</strong>
            <span className="muted composer-reply-preview">
              {replyTo.sticker_id ? "Figurinha" : replyTo.content.slice(0, 80)}
            </span>
          </div>
          <button
            type="button"
            className="neo-btn neo-btn-icon"
            aria-label="Cancelar resposta"
            onClick={onCancelReply}
          >
            <IconClose />
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="composer-attachments">
          {pending.map((p, i) => (
            <div key={`${p.file.name}-${i}`} className="composer-attach-chip">
              {p.file.type.startsWith("image/") ? (
                <img src={p.previewUrl} alt="" />
              ) : (
                <span className="composer-attach-icon" aria-hidden>
                  <IconPaperclip />
                </span>
              )}
              <span className="composer-attach-name">{p.file.name}</span>
              <button
                type="button"
                className="composer-attach-remove"
                aria-label={`Remover ${p.file.name}`}
                onClick={() => removePending(i)}
              >
                <IconClose />
              </button>
            </div>
          ))}
        </div>
      )}

      {localError && <p className="composer-error">{localError}</p>}
      {disabled && disabledHint && <p className="composer-error">{disabledHint}</p>}

      <div className="composer-wa" style={{ position: "relative" }}>
        <div className="composer-field">
          <NeoTooltip label="Emoji" side="top">
            <button
              className="composer-icon-btn"
              type="button"
              aria-label="Emoji"
              disabled={disabled}
              onClick={() => {
                setStickerOpen(false);
                setEmojiOpen((v) => !v);
              }}
            >
              <IconSmile />
            </button>
          </NeoTooltip>
          <NeoTooltip label="Figurinha" side="top">
            <button
              className="composer-icon-btn"
              type="button"
              aria-label="Figurinha"
              disabled={disabled}
              onClick={() => {
                setEmojiOpen(false);
                setStickerOpen((v) => !v);
              }}
            >
              <IconSticker />
            </button>
          </NeoTooltip>
          <NeoTooltip label="Anexar arquivo" side="top">
            <button
              className="composer-icon-btn"
              type="button"
              aria-label="Anexar arquivo"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              <IconPaperclip />
            </button>
          </NeoTooltip>
          {onCreatePoll && (
            <NeoTooltip label="Criar enquete" side="top">
              <button
                className="composer-icon-btn"
                type="button"
                aria-label="Criar enquete"
                disabled={disabled}
                onClick={onCreatePoll}
              >
                <IconPoll />
              </button>
            </NeoTooltip>
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={MEDIA_LIMITS.attachment.accept}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void addFiles(files);
            }}
          />
          <input
            ref={inputRef}
            className="composer-input"
            placeholder={placeholder}
            value={draft}
            disabled={disabled}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            onChange={(e) => {
              const value = e.target.value;
              setDraft(value);
              syncMentionState(value, e.target.selectionStart ?? value.length);
              if (value.trim()) onTyping?.();
            }}
            onKeyDown={(e) => {
              if (mentionOpen && filteredMentions.length) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIndex((i) => (i + 1) % filteredMentions.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex((i) => (i - 1 + filteredMentions.length) % filteredMentions.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const pick = filteredMentions[mentionIndex];
                  if (pick) pickMention(pick);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionOpen(false);
                  return;
                }
              }
              if (e.key === "Escape" && replyTo) {
                e.preventDefault();
                onCancelReply?.();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <button
          className="composer-send"
          type="button"
          onClick={submit}
          aria-label="Enviar"
          disabled={!canSubmit}
        >
          <IconSend />
        </button>
        {mentionOpen && filteredMentions.length > 0 && (
          <div className="mention-menu" role="listbox">
            {filteredMentions.map((m, i) => (
              <button
                key={m.id}
                type="button"
                className={`mention-option ${i === mentionIndex ? "active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(m);
                }}
              >
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" className="mention-option-avatar" />
                ) : (
                  <span className="mention-option-avatar mention-option-fallback">
                    {m.display_name[0]?.toUpperCase() ?? "?"}
                  </span>
                )}
                <span>
                  <strong>{m.display_name}</strong>
                  <span className="muted"> @{m.username}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <EmojiPicker
          open={emojiOpen}
          onClose={() => setEmojiOpen(false)}
          onPick={(emoji) => setDraft((d) => d + emoji)}
        />
        <StickerPicker
          open={stickerOpen}
          onClose={() => setStickerOpen(false)}
          onPick={(s) => {
            setStickerOpen(false);
            onSendSticker(s, replyTo?.id ?? null);
          }}
        />
      </div>
    </div>
  );
});
