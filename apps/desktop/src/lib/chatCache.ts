import type {
  Message,
  MessageAttachment,
  MessagePollAgg,
  MessageReactionAgg,
  MessageReplySnippet,
  Profile,
  Sticker,
} from "@molezinha/shared";
import { supabase } from "./supabase";

export type AuthorSnippet = Pick<Profile, "id" | "display_name" | "avatar_url" | "username">;
export type StickerSnippet = Pick<Sticker, "id" | "name" | "file_url">;

const AUTHOR_COLS = "id, display_name, avatar_url, username";
const STICKER_COLS = "id, name, file_url";

const REPLY_EMBED = `reply_to:reply_to_id(id, content, author_id, sticker_id, profiles:author_id(${AUTHOR_COLS}))`;

/** Shared caches so realtime INSERTs rarely need extra round-trips. */
export const authorCache = new Map<string, AuthorSnippet>();
export const stickerCache = new Map<string, StickerSnippet>();

export function cacheAuthor(p: AuthorSnippet | null | undefined) {
  if (p?.id) authorCache.set(p.id, p);
}

export function cacheSticker(s: StickerSnippet | null | undefined) {
  if (s?.id) stickerCache.set(s.id, s);
}

export function cacheAuthors(list: AuthorSnippet[]) {
  for (const p of list) cacheAuthor(p);
}

let beepCtx: AudioContext | null = null;

/** Soft two-note chime for incoming messages. */
export function playMessageBeep() {
  try {
    beepCtx ??= new AudioContext();
    const ctx = beepCtx;
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);

    const notes = [784, 988];
    notes.forEach((freq, i) => {
      const start = t0 + i * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  } catch {
    /* ignore */
  }
}

export function aggregateReactions(
  rows: { emoji: string; user_id: string }[],
  myUserId?: string | null
): MessageReactionAgg[] {
  const map = new Map<string, MessageReactionAgg>();
  for (const r of rows) {
    const cur = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, me: false };
    cur.count += 1;
    if (myUserId && r.user_id === myUserId) cur.me = true;
    map.set(r.emoji, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

async function loadReactionsForMessages(
  table: "message_reactions" | "dm_message_reactions",
  messageIds: string[],
  myUserId?: string | null
): Promise<Map<string, MessageReactionAgg[]>> {
  const out = new Map<string, MessageReactionAgg[]>();
  if (!messageIds.length) return out;
  const { data } = await supabase
    .from(table)
    .select("message_id, emoji, user_id")
    .in("message_id", messageIds);
  const byMsg = new Map<string, { emoji: string; user_id: string }[]>();
  for (const row of data ?? []) {
    const list = byMsg.get(row.message_id) ?? [];
    list.push({ emoji: row.emoji, user_id: row.user_id });
    byMsg.set(row.message_id, list);
  }
  for (const [id, rows] of byMsg) {
    out.set(id, aggregateReactions(rows, myUserId));
  }
  return out;
}

async function loadPinnedIds(channelId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("channel_pins")
    .select("message_id")
    .eq("channel_id", channelId);
  return new Set((data ?? []).map((r) => r.message_id as string));
}

async function loadAttachmentsForMessages(
  kind: "channel" | "dm",
  messageIds: string[]
): Promise<Map<string, MessageAttachment[]>> {
  const out = new Map<string, MessageAttachment[]>();
  if (!messageIds.length) return out;
  const col = kind === "channel" ? "message_id" : "dm_message_id";
  const { data } = await supabase
    .from("message_attachments")
    .select("*")
    .in(col, messageIds);
  for (const row of (data as MessageAttachment[]) ?? []) {
    const key = (kind === "channel" ? row.message_id : row.dm_message_id) as string;
    const list = out.get(key) ?? [];
    list.push(row);
    out.set(key, list);
  }
  return out;
}

async function loadPollsForMessages(
  messageIds: string[],
  myUserId?: string | null
): Promise<Map<string, MessagePollAgg>> {
  const out = new Map<string, MessagePollAgg>();
  if (!messageIds.length) return out;
  const { data: polls } = await supabase
    .from("message_polls")
    .select("id, message_id, question")
    .in("message_id", messageIds);
  if (!polls?.length) return out;
  const pollIds = polls.map((p) => p.id as string);
  const { data: options } = await supabase
    .from("message_poll_options")
    .select("id, poll_id, label, position")
    .in("poll_id", pollIds)
    .order("position");
  const { data: votes } = await supabase
    .from("message_poll_votes")
    .select("poll_id, option_id, user_id")
    .in("poll_id", pollIds);

  const votesByPoll = new Map<string, { option_id: string; user_id: string }[]>();
  for (const v of votes ?? []) {
    const list = votesByPoll.get(v.poll_id) ?? [];
    list.push({ option_id: v.option_id, user_id: v.user_id });
    votesByPoll.set(v.poll_id, list);
  }

  for (const p of polls) {
    const opts = (options ?? []).filter((o) => o.poll_id === p.id);
    const vlist = votesByPoll.get(p.id) ?? [];
    const my = myUserId ? vlist.find((v) => v.user_id === myUserId) : null;
    const aggOpts = opts.map((o) => ({
      id: o.id as string,
      label: o.label as string,
      position: o.position as number,
      votes: vlist.filter((v) => v.option_id === o.id).length,
    }));
    out.set(p.message_id as string, {
      id: p.id as string,
      question: p.question as string,
      options: aggOpts,
      myOptionId: my?.option_id ?? null,
      totalVotes: vlist.length,
    });
  }
  return out;
}

function normalizeReply(raw: unknown): MessageReplySnippet | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as MessageReplySnippet & { profiles?: AuthorSnippet | AuthorSnippet[] };
  const profiles = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  if (profiles) cacheAuthor(profiles);
  return { ...r, profiles };
}

export async function hydrateMessage(
  row: Message,
  opts?: { myUserId?: string | null; kind?: "channel" | "dm" }
): Promise<Message> {
  let author = authorCache.get(row.author_id);
  if (!author) {
    const { data } = await supabase
      .from("profiles")
      .select(AUTHOR_COLS)
      .eq("id", row.author_id)
      .maybeSingle();
    if (data) {
      author = data as AuthorSnippet;
      authorCache.set(author.id, author);
    }
  }

  let stickers: Message["stickers"] = null;
  if (row.sticker_id) {
    stickers = stickerCache.get(row.sticker_id) ?? null;
    if (!stickers) {
      const { data } = await supabase
        .from("stickers")
        .select(STICKER_COLS)
        .eq("id", row.sticker_id)
        .maybeSingle();
      if (data) {
        stickers = data as StickerSnippet;
        stickerCache.set(stickers.id, stickers);
      }
    }
  }

  let reply_to = normalizeReply(row.reply_to) ?? null;
  if (!reply_to && row.reply_to_id) {
    const table = opts?.kind === "dm" || row.conversation_id ? "direct_messages" : "messages";
    const { data } = await supabase
      .from(table)
      .select(`id, content, author_id, sticker_id, profiles:author_id(${AUTHOR_COLS})`)
      .eq("id", row.reply_to_id)
      .maybeSingle();
    if (data) reply_to = normalizeReply(data);
  }

  let reactions = row.reactions;
  if (!reactions && opts?.myUserId !== undefined) {
    const table =
      opts.kind === "dm" || row.conversation_id
        ? "dm_message_reactions"
        : "message_reactions";
    const map = await loadReactionsForMessages(table, [row.id], opts.myUserId);
    reactions = map.get(row.id) ?? [];
  }

  const kind: "channel" | "dm" =
    opts?.kind ?? (row.conversation_id ? "dm" : "channel");
  let attachments = row.attachments;
  if (!attachments) {
    const map = await loadAttachmentsForMessages(kind, [row.id]);
    attachments = map.get(row.id) ?? [];
  }

  let poll = row.poll ?? null;
  if (poll === undefined && kind === "channel") {
    const map = await loadPollsForMessages([row.id], opts?.myUserId);
    poll = map.get(row.id) ?? null;
  }

  return {
    ...row,
    profiles: author ?? undefined,
    stickers,
    reply_to,
    reactions: reactions ?? row.reactions ?? [],
    attachments: attachments ?? [],
    poll: poll ?? null,
  };
}

export async function fetchRecentMessages(
  table: "messages" | "direct_messages",
  filterCol: "channel_id" | "conversation_id",
  filterVal: string,
  myUserId?: string | null
): Promise<Message[]> {
  const { data, error } = await supabase
    .from(table)
    .select(
      `*, profiles:author_id(${AUTHOR_COLS}), stickers:sticker_id(${STICKER_COLS}), ${REPLY_EMBED}`
    )
    .eq(filterCol, filterVal)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return [];

  const rows = ((data as Message[]) ?? []).slice().reverse();
  for (const m of rows) {
    if (m.profiles) cacheAuthor(m.profiles);
    const st = Array.isArray(m.stickers) ? m.stickers[0] : m.stickers;
    if (st) cacheSticker(st);
    m.reply_to = normalizeReply(m.reply_to);
  }

  const ids = rows.map((m) => m.id);
  const reactionTable =
    table === "messages" ? "message_reactions" : "dm_message_reactions";
  const reactionMap = await loadReactionsForMessages(reactionTable, ids, myUserId);
  const kind = table === "messages" ? "channel" : "dm";
  const attachmentMap = await loadAttachmentsForMessages(kind, ids);
  const pollMap =
    table === "messages" ? await loadPollsForMessages(ids, myUserId) : new Map();

  let pinned = new Set<string>();
  if (table === "messages") {
    pinned = await loadPinnedIds(filterVal);
  }

  return rows.map((m) => ({
    ...m,
    reactions: reactionMap.get(m.id) ?? [],
    attachments: attachmentMap.get(m.id) ?? [],
    poll: pollMap.get(m.id) ?? null,
    pinned: pinned.has(m.id),
  }));
}

export type PendingAttachment = {
  file: File;
  previewUrl: string;
  width?: number | null;
  height?: number | null;
};

export async function uploadMessageAttachments(
  userId: string,
  messageId: string,
  kind: "channel" | "dm",
  files: PendingAttachment[]
): Promise<MessageAttachment[]> {
  const uploaded: MessageAttachment[] = [];
  for (const item of files) {
    const ext = item.file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("message-media")
      .upload(path, item.file, { contentType: item.file.type, upsert: false });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from("message-media").getPublicUrl(path);
    const row: Record<string, unknown> = {
      ...(kind === "channel" ? { message_id: messageId } : { dm_message_id: messageId }),
      uploader_id: userId,
      file_url: pub.publicUrl,
      file_name: item.file.name.slice(0, 180),
      mime_type: item.file.type || "application/octet-stream",
      byte_size: item.file.size,
      width: item.width ?? null,
      height: item.height ?? null,
    };
    const { data, error } = await supabase
      .from("message_attachments")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    uploaded.push(data as MessageAttachment);
  }
  return uploaded;
}
