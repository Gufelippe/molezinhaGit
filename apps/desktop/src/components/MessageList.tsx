import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Message, MessageAttachment, MessagePollAgg } from "@molezinha/shared";
import { parseMentionTokens } from "../lib/notifications";
import { formatChatTime, formatFullTime } from "../lib/datetime";
import { extractYoutubeUrl } from "../lib/musicApi";
import { Avatar } from "./Avatar";
import { EmptyState, type EmptyArt } from "./EmptyState";
import { NeoTooltip } from "./NeoTooltip";
import {
  IconBookmark,
  IconClose,
  IconMusic,
  IconPaperclip,
  IconPin,
  IconPoll,
  IconReply,
  IconSmile,
} from "./Icons";
import {
  MessageContextMenu,
  type ContextMenuAction,
} from "./MessageContextMenu";
import { EmojiPicker } from "./EmojiPicker";

const GROUP_MS = 5 * 60 * 1000;
const HIGHLIGHT_MS = 2400;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

function MessageBody({
  content,
  myUsername,
}: {
  content: string;
  myUsername?: string | null;
}) {
  const tokens = parseMentionTokens(content);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === "text") return <span key={i}>{t.value}</span>;
        const isMe =
          Boolean(myUsername) &&
          t.value.toLowerCase() === myUsername!.toLowerCase();
        return (
          <span key={i} className={`msg-mention ${isMe ? "msg-mention-me" : ""}`}>
            @{t.value}
          </span>
        );
      })}
    </>
  );
}

function AttachmentGrid({
  attachments,
  onOpenImage,
}: {
  attachments: MessageAttachment[];
  onOpenImage: (att: MessageAttachment) => void;
}) {
  const images = attachments.filter((a) => a.mime_type.startsWith("image/"));
  const files = attachments.filter((a) => !a.mime_type.startsWith("image/"));
  return (
    <div className="msg-attachments">
      {images.length > 0 && (
        <div className={`msg-attach-grid count-${Math.min(images.length, 4)}`}>
          {images.map((a) => (
            <button
              key={a.id}
              type="button"
              className="msg-attach-image"
              onClick={() => onOpenImage(a)}
              aria-label={`Abrir ${a.file_name}`}
            >
              <img src={a.file_url} alt={a.file_name} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
      {files.map((a) => (
        <a
          key={a.id}
          className="msg-attach-file"
          href={a.file_url}
          target="_blank"
          rel="noreferrer"
          download={a.file_name}
        >
          <IconPaperclip />
          <span className="msg-attach-file-name">{a.file_name}</span>
          <span className="muted">{formatBytes(a.byte_size)}</span>
        </a>
      ))}
    </div>
  );
}

function PollCard({
  poll,
  onVote,
}: {
  poll: MessagePollAgg;
  onVote?: (pollId: string, optionId: string) => void;
}) {
  const total = poll.totalVotes || 0;
  return (
    <div className="msg-poll">
      <div className="msg-poll-question">
        <IconPoll />
        <span>{poll.question}</span>
      </div>
      <div className="msg-poll-options">
        {poll.options.map((o) => {
          const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
          const mine = poll.myOptionId === o.id;
          return (
            <button
              key={o.id}
              type="button"
              className={`msg-poll-option ${mine ? "mine" : ""}`}
              disabled={!onVote}
              onClick={() => onVote?.(poll.id, o.id)}
            >
              <span className="msg-poll-bar" style={{ width: `${pct}%` }} aria-hidden />
              <span className="msg-poll-label">{o.label}</span>
              <span className="msg-poll-count">{pct}%</span>
            </button>
          );
        })}
      </div>
      <div className="muted msg-poll-total">
        {total === 1 ? "1 voto" : `${total} votos`}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  grouped,
  highlighted,
  myUsername,
  myUserId,
  canModerate,
  canPin,
  savedStickerIds,
  onSaveSticker,
  onContextAction,
  onToggleReaction,
  onVotePoll,
  onOpenImage,
  onPlayYoutube,
}: {
  message: Message;
  grouped: boolean;
  highlighted?: boolean;
  myUsername?: string | null;
  myUserId?: string | null;
  canModerate: boolean;
  canPin: boolean;
  savedStickerIds?: Set<string>;
  onSaveSticker?: (stickerId: string) => Promise<void> | void;
  onContextAction: (message: Message, action: ContextMenuAction) => void;
  onToggleReaction: (message: Message, emoji: string) => void;
  onVotePoll?: (pollId: string, optionId: string) => void;
  onOpenImage: (att: MessageAttachment) => void;
  onPlayYoutube?: (url: string) => void;
}) {
  const st = Array.isArray(message.stickers) ? message.stickers[0] : message.stickers;
  const stickerUrl = message.sticker_id && st?.file_url ? st.file_url : null;
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [emojiPick, setEmojiPick] = useState(false);
  const canSave =
    Boolean(message.sticker_id) &&
    Boolean(onSaveSticker) &&
    Boolean(myUserId) &&
    !savedStickerIds?.has(message.sticker_id!);
  const canDelete = Boolean(myUserId) && (message.author_id === myUserId || canModerate);
  const plainText = message.sticker_id ? "" : message.content;
  const reply = message.reply_to;
  const fwd = message.forwarded_from;
  const attachments = message.attachments ?? [];
  const attachmentOnly = attachments.length > 0 && message.content.trim() === "📎";
  // The poll card already shows the question — the message text is only a fallback for previews.
  const pollOnly = Boolean(message.poll);
  const youtubeUrl = !pollOnly && !attachmentOnly && !stickerUrl ? extractYoutubeUrl(plainText) : null;

  return (
    <div
      className={`message-row ${grouped ? "message-row-grouped" : ""} ${message.pinned ? "message-row-pinned" : ""} ${highlighted ? "message-row-highlight" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {grouped ? (
        <div className="message-avatar-spacer" aria-hidden />
      ) : (
        <Avatar
          name={message.profiles?.display_name ?? "?"}
          url={message.profiles?.avatar_url}
          id={message.author_id}
        />
      )}
      <div className="message-content">
        {!grouped && (
          <div className="message-meta">
            <strong>{message.profiles?.display_name ?? "Alguém"}</strong>
            <time
              className="muted"
              dateTime={message.created_at}
              title={formatFullTime(message.created_at)}
            >
              {formatChatTime(message.created_at)}
            </time>
            {message.pinned && (
              <span className="msg-pin-badge" title="Fixada">
                <IconPin />
              </span>
            )}
            {message.bookmarked && (
              <span className="msg-pin-badge" title="Salva">
                <IconBookmark />
              </span>
            )}
          </div>
        )}
        {fwd && (
          <div className="msg-forward-banner">
            Encaminhada de <strong>{fwd.author_display_name}</strong>
          </div>
        )}
        {reply && (
          <div className="msg-reply-quote">
            <strong>{reply.profiles?.display_name ?? "Alguém"}</strong>
            <span className="muted">
              {reply.sticker_id ? "Figurinha" : reply.content.slice(0, 120)}
            </span>
          </div>
        )}
        {!attachmentOnly && !pollOnly && (
          <div className="message-body">
            {stickerUrl ? (
              <div className="sticker-message-wrap">
                <img
                  className="sticker-message"
                  src={stickerUrl}
                  alt={st?.name ?? "figurinha"}
                  loading="lazy"
                  decoding="async"
                />
                {canSave && (
                  <NeoTooltip label="Salvar na minha coleção" side="top">
                    <button
                      type="button"
                      className="sticker-save-btn"
                      disabled={saving}
                      onClick={() => {
                        if (!message.sticker_id || !onSaveSticker) return;
                        setSaving(true);
                        void Promise.resolve(onSaveSticker(message.sticker_id)).finally(() =>
                          setSaving(false)
                        );
                      }}
                    >
                      {saving ? "…" : "Salvar"}
                    </button>
                  </NeoTooltip>
                )}
              </div>
            ) : (
              <MessageBody content={message.content} myUsername={myUsername} />
            )}
          </div>
        )}
        {youtubeUrl && onPlayYoutube && (
          <button
            type="button"
            className="msg-play-yt"
            onClick={() => onPlayYoutube(youtubeUrl)}
          >
            <IconMusic />
            Tocar na call
          </button>
        )}
        {attachments.length > 0 && (
          <AttachmentGrid attachments={attachments} onOpenImage={onOpenImage} />
        )}
        {message.poll && <PollCard poll={message.poll} onVote={onVotePoll} />}
        {(message.reactions?.length ?? 0) > 0 && (
          <div className="msg-reactions">
            {message.reactions!.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={`msg-reaction-chip ${r.me ? "me" : ""}`}
                onClick={() => onToggleReaction(message, r.emoji)}
              >
                <span>{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="msg-hover-actions">
        <NeoTooltip label="Responder" side="top">
          <button
            type="button"
            className="msg-hover-btn"
            aria-label="Responder"
            onClick={() => onContextAction(message, { type: "reply" })}
          >
            <IconReply />
          </button>
        </NeoTooltip>
        <NeoTooltip label="Reagir" side="top">
          <button
            type="button"
            className="msg-hover-btn"
            aria-label="Reagir"
            onClick={() => setEmojiPick(true)}
          >
            <IconSmile />
          </button>
        </NeoTooltip>
        <NeoTooltip label="Mais ações" side="top">
          <button
            type="button"
            className="msg-hover-btn"
            aria-label="Mais ações"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenu({ x: rect.right - 8, y: rect.bottom + 4 });
            }}
          >
            <span aria-hidden>⋯</span>
          </button>
        </NeoTooltip>
      </div>

      {menu && (
        <MessageContextMenu
          x={menu.x}
          y={menu.y}
          canDelete={canDelete}
          canPin={canPin}
          pinned={Boolean(message.pinned)}
          bookmarked={Boolean(message.bookmarked)}
          hasText={Boolean(plainText.trim())}
          onClose={() => setMenu(null)}
          onAction={(action) => {
            if (action.type === "addReaction") {
              setMenu(null);
              setEmojiPick(true);
              return;
            }
            setMenu(null);
            onContextAction(message, action);
          }}
        />
      )}
      {emojiPick && (
        <div className="msg-reaction-picker-anchor">
          <EmojiPicker
            open
            onClose={() => setEmojiPick(false)}
            onPick={(emoji) => {
              setEmojiPick(false);
              onToggleReaction(message, emoji);
            }}
          />
        </div>
      )}
    </div>
  );
}

const MemoRow = memo(MessageRow);

interface Props {
  messages: Message[];
  unreadSince?: string | null;
  myUsername?: string | null;
  myUserId?: string | null;
  canModerate?: boolean;
  canPin?: boolean;
  savedStickerIds?: Set<string>;
  highlightMessageId?: string | null;
  typingUsers?: string[];
  emptyTitle?: string;
  emptyHint?: string;
  emptyArt?: EmptyArt;
  onSaveSticker?: (stickerId: string) => Promise<void> | void;
  onContextAction: (message: Message, action: ContextMenuAction) => void;
  onToggleReaction: (message: Message, emoji: string) => void;
  onVotePoll?: (pollId: string, optionId: string) => void;
  onPlayYoutube?: (url: string) => void;
}

function UnreadDivider({ at }: { at: string }) {
  const dateLabel = new Date(at).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <div className="msg-unread-divider" role="separator">
      <span className="msg-unread-divider-line" />
      <span className="msg-unread-divider-date">{dateLabel}</span>
      <span className="msg-unread-divider-line" />
      <span className="msg-unread-novo">NOVO</span>
    </div>
  );
}

function DaySeparator({ at }: { at: string }) {
  return (
    <div className="msg-day-divider" role="separator">
      <span className="msg-day-divider-line" />
      <span className="msg-day-divider-label">{dayLabel(at)}</span>
      <span className="msg-day-divider-line" />
    </div>
  );
}

function TypingIndicator({ names }: { names: string[] }) {
  const label =
    names.length === 1
      ? `${names[0]} está digitando`
      : names.length === 2
        ? `${names[0]} e ${names[1]} estão digitando`
        : "Várias pessoas estão digitando";
  return (
    <div className="typing-indicator" aria-live="polite">
      <span className="typing-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="muted">{label}…</span>
    </div>
  );
}

export const MessageList = memo(function MessageList({
  messages,
  unreadSince = null,
  myUsername,
  myUserId,
  canModerate = false,
  canPin = false,
  savedStickerIds,
  highlightMessageId = null,
  typingUsers = [],
  emptyTitle = "Nada por aqui ainda",
  emptyHint = "Manda a primeira mensagem — o resto a gente resolve depois.",
  emptyArt = "messages",
  onSaveSticker,
  onContextAction,
  onToggleReaction,
  onVotePoll,
  onPlayYoutube,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const seenIds = useRef<Set<string> | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<MessageAttachment | null>(null);
  const unreadTs = unreadSince ? new Date(unreadSince).getTime() : null;

  const openImage = useCallback((att: MessageAttachment) => setLightbox(att), []);

  useEffect(() => {
    if (highlightMessageId) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, highlightMessageId]);

  useEffect(() => {
    if (!highlightMessageId) {
      setFlashId(null);
      return;
    }
    const el = rowRefs.current.get(highlightMessageId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(highlightMessageId);
    const t = setTimeout(() => setFlashId(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlightMessageId, messages]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // Only messages that show up after the first paint animate in; the initial
  // batch would otherwise cascade every time a channel is opened.
  useEffect(() => {
    seenIds.current = new Set(messages.map((m) => m.id));
  }, [messages]);

  return (
    <div className="messages">
      {messages.length === 0 && (
        <EmptyState className="messages-empty" art={emptyArt} title={emptyTitle} hint={emptyHint} />
      )}
      {messages.map((m, i) => {
        const prev = i > 0 ? messages[i - 1] : null;
        const sameAuthor = Boolean(prev && prev.author_id === m.author_id);
        const gapMs = prev
          ? new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()
          : Infinity;
        const showDayBar = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
        const showUnreadBar =
          unreadTs !== null &&
          new Date(m.created_at).getTime() >= unreadTs &&
          (!prev || new Date(prev.created_at).getTime() < unreadTs);
        const grouped =
          !showUnreadBar &&
          !showDayBar &&
          sameAuthor &&
          gapMs < GROUP_MS &&
          !m.reply_to_id &&
          !prev?.reply_to_id;
        return (
          <div
            key={m.id}
            className={seenIds.current?.has(m.id) === false ? "message-enter" : undefined}
            ref={(el) => {
              if (el) rowRefs.current.set(m.id, el);
              else rowRefs.current.delete(m.id);
            }}
          >
            {showDayBar && <DaySeparator at={m.created_at} />}
            {showUnreadBar && unreadSince && <UnreadDivider at={unreadSince} />}
            <MemoRow
              message={m}
              grouped={grouped}
              highlighted={flashId === m.id}
              myUsername={myUsername}
              myUserId={myUserId}
              canModerate={canModerate}
              canPin={canPin}
              savedStickerIds={savedStickerIds}
              onSaveSticker={onSaveSticker}
              onContextAction={onContextAction}
              onToggleReaction={onToggleReaction}
              onVotePoll={onVotePoll}
              onOpenImage={openImage}
              onPlayYoutube={onPlayYoutube}
            />
          </div>
        );
      })}
      {typingUsers.length > 0 && <TypingIndicator names={typingUsers} />}
      <div ref={bottomRef} />

      {lightbox && (
        <div className="lightbox" role="dialog" aria-label={lightbox.file_name} onClick={() => setLightbox(null)}>
          <button
            type="button"
            className="lightbox-close"
            aria-label="Fechar"
            onClick={() => setLightbox(null)}
          >
            <IconClose />
          </button>
          <img
            src={lightbox.file_url}
            alt={lightbox.file_name}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="lightbox-caption">
            <span>{lightbox.file_name}</span>
            <a href={lightbox.file_url} target="_blank" rel="noreferrer" download={lightbox.file_name}>
              Abrir original
            </a>
          </div>
        </div>
      )}
    </div>
  );
});
