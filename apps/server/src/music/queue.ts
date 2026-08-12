import { randomUUID } from "node:crypto";
import type { MusicChannelState, MusicTrack } from "@molezinha/shared";
import { getRoom } from "../mediasoup.js";
import { broadcastRoom, ensureMusicBotPeer, removeMusicBotPeer } from "./botPeer.js";
import { playUrlIntoChannel, type PlayerHandle } from "./player.js";
import { resolveYoutube } from "./youtube.js";

const MAX_QUEUE = 20;
const MAX_ACTIVE_PLAYERS = 2;

type ChannelMusic = {
  channelId: string;
  nowPlaying: MusicTrack | null;
  queue: MusicTrack[];
  player: PlayerHandle | null;
  starting: boolean;
};

const channels = new Map<string, ChannelMusic>();

function getOrCreate(channelId: string): ChannelMusic {
  let state = channels.get(channelId);
  if (!state) {
    state = {
      channelId,
      nowPlaying: null,
      queue: [],
      player: null,
      starting: false,
    };
    channels.set(channelId, state);
  }
  return state;
}

export function getMusicState(channelId: string): MusicChannelState {
  const state = channels.get(channelId);
  return {
    channelId,
    nowPlaying: state?.nowPlaying ?? null,
    queue: state?.queue ?? [],
  };
}

function fanoutState(channelId: string) {
  const room = getRoom(channelId);
  if (!room) return;
  broadcastRoom(room, { type: "musicState", state: getMusicState(channelId) });
}

function countActivePlayers() {
  let n = 0;
  for (const c of channels.values()) {
    if (c.nowPlaying || c.starting) n += 1;
  }
  return n;
}

async function pump(channelId: string) {
  const state = getOrCreate(channelId);
  if (state.starting || state.nowPlaying) return;

  const next = state.queue.shift();
  if (!next) {
    removeMusicBotPeer(channelId);
    fanoutState(channelId);
    return;
  }

  if (countActivePlayers() >= MAX_ACTIVE_PLAYERS) {
    // Put it back — global concurrency gate. Another room finishing will pump again.
    state.queue.unshift(next);
    state.starting = false;
    state.nowPlaying = null;
    fanoutState(channelId);
    return;
  }

  state.starting = true;
  state.nowPlaying = next;
  fanoutState(channelId);

  try {
    await ensureMusicBotPeer(channelId);
    const meta = await resolveYoutube(next.url);
    state.nowPlaying = {
      ...next,
      title: meta.title || next.title,
      thumbnail: meta.thumbnail ?? next.thumbnail,
    };
    fanoutState(channelId);

    const handle = await playUrlIntoChannel(channelId, meta.streamUrl);
    state.player = handle;
    state.starting = false;

    await handle.done;
  } catch (err) {
    console.warn("[music] track failed", channelId, err);
  } finally {
    state.player = null;
    state.nowPlaying = null;
    state.starting = false;
    fanoutState(channelId);
    // Continue with the next queued track, if any — and wake other gated channels.
    void pump(channelId).catch((e) => console.warn("[music] pump", e));
    for (const id of channels.keys()) {
      if (id === channelId) continue;
      void pump(id).catch((e) => console.warn("[music] pump", e));
    }
  }
}

export async function enqueueTrack(input: {
  channelId: string;
  url: string;
  userId: string;
  displayName: string;
}): Promise<MusicChannelState> {
  const state = getOrCreate(input.channelId);
  if (state.queue.length >= MAX_QUEUE) {
    throw new Error(`Fila cheia (máx. ${MAX_QUEUE})`);
  }

  // Resolve metadata early so the UI shows a real title.
  const meta = await resolveYoutube(input.url);
  const track: MusicTrack = {
    trackId: randomUUID(),
    url: input.url.trim(),
    title: meta.title,
    thumbnail: meta.thumbnail,
    requestedBy: input.userId,
    requestedByName: input.displayName,
  };

  state.queue.push(track);
  fanoutState(input.channelId);

  if (!state.nowPlaying && !state.starting) {
    void pump(input.channelId).catch((e) => console.warn("[music] pump", e));
  }

  return getMusicState(input.channelId);
}

export function skipTrack(channelId: string, userId: string, isStaff: boolean): MusicChannelState {
  const state = getOrCreate(channelId);
  const current = state.nowPlaying;
  if (!current) throw new Error("Nada tocando");
  if (!isStaff && current.requestedBy !== userId) {
    throw new Error("Só quem pediu a faixa (ou um admin) pode pular");
  }
  state.player?.stop();
  return getMusicState(channelId);
}

export function stopChannel(channelId: string): MusicChannelState {
  const state = channels.get(channelId);
  if (!state) return getMusicState(channelId);
  state.queue = [];
  state.player?.stop();
  state.nowPlaying = null;
  state.starting = false;
  removeMusicBotPeer(channelId);
  fanoutState(channelId);
  return getMusicState(channelId);
}

export function removeTrack(
  channelId: string,
  trackId: string,
  userId: string,
  isStaff: boolean
): MusicChannelState {
  const state = getOrCreate(channelId);
  const idx = state.queue.findIndex((t) => t.trackId === trackId);
  if (idx < 0) throw new Error("Faixa não está na fila");
  const track = state.queue[idx]!;
  if (!isStaff && track.requestedBy !== userId) {
    throw new Error("Só quem pediu a faixa (ou um admin) pode remover");
  }
  state.queue.splice(idx, 1);
  fanoutState(channelId);
  return getMusicState(channelId);
}
