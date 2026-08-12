import type { PlainTransport, Producer } from "mediasoup/types";
import {
  getOrCreateRoom,
  getRoom,
  type PeerState,
  type RoomState,
} from "../mediasoup.js";

export const MUSIC_BOT_USER_ID = "music-bot";

export function musicBotPeerId(channelId: string) {
  return `music:${channelId}`;
}

export function isMusicBotPeer(peerId: string) {
  return peerId.startsWith("music:");
}

export function countHumanPeers(room: RoomState) {
  let n = 0;
  for (const peer of room.peers.values()) {
    if (!isMusicBotPeer(peer.peerId)) n += 1;
  }
  return n;
}

export function broadcastRoom(room: RoomState, msg: unknown, exceptPeerId?: string) {
  for (const peer of room.peers.values()) {
    if (exceptPeerId && peer.peerId === exceptPeerId) continue;
    if (isMusicBotPeer(peer.peerId)) continue;
    peer.send(msg);
  }
}

/** Ensures a synthetic "Música" peer exists in the room for roster + producers. */
export async function ensureMusicBotPeer(channelId: string): Promise<PeerState> {
  const room = await getOrCreateRoom(channelId);
  const peerId = musicBotPeerId(channelId);
  const existing = room.peers.get(peerId);
  if (existing) return existing;

  const peer: PeerState = {
    peerId,
    userId: MUSIC_BOT_USER_ID,
    displayName: "Música",
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
    send: () => undefined,
  };
  room.peers.set(peerId, peer);

  broadcastRoom(room, {
    type: "peerJoined",
    peer: {
      peerId: peer.peerId,
      userId: peer.userId,
      displayName: peer.displayName,
      producers: [],
    },
  });

  return peer;
}

export type MusicProducerBundle = {
  transport: PlainTransport;
  producer: Producer;
  rtpPort: number;
  rtcpPort: number;
  ssrc: number;
  payloadType: number;
};

/**
 * Creates a PlainTransport producer that FFmpeg can feed with Opus/RTP.
 * `comedia: true` learns the remote address from the first packet.
 */
export async function createMusicProducer(channelId: string): Promise<MusicProducerBundle> {
  const room = await getOrCreateRoom(channelId);
  const peer = await ensureMusicBotPeer(channelId);

  // Close any previous music producer on this bot peer.
  for (const [id, producer] of [...peer.producers.entries()]) {
    producer.close();
    peer.producers.delete(id);
    broadcastRoom(room, {
      type: "producerClosed",
      peerId: peer.peerId,
      producerId: id,
    });
  }
  for (const [id, transport] of [...peer.transports.entries()]) {
    transport.close();
    peer.transports.delete(id);
  }

  const transport = await room.router.createPlainTransport({
    listenInfo: { protocol: "udp", ip: "127.0.0.1", portRange: { min: 40000, max: 40100 } },
    rtcpMux: false,
    comedia: true,
  });

  const rtpPort = transport.tuple.localPort;
  const rtcpPort = transport.rtcpTuple?.localPort;
  if (!rtpPort || !rtcpPort) {
    transport.close();
    throw new Error("PlainTransport did not bind RTP/RTCP ports");
  }

  const ssrc = 22222222 + (Math.floor(Math.random() * 1000) % 1000);
  const payloadType = 100;

  const producer = await transport.produce({
    kind: "audio",
    rtpParameters: {
      codecs: [
        {
          mimeType: "audio/opus",
          clockRate: 48000,
          payloadType,
          channels: 2,
          parameters: { minptime: 10, useinbandfec: 1 },
          rtcpFeedback: [],
        },
      ],
      headerExtensions: [],
      encodings: [{ ssrc }],
      rtcp: { cname: `music-${channelId.slice(0, 8)}`, reducedSize: true },
    },
    appData: { source: "music" },
  });

  peer.transports.set(transport.id, transport);
  peer.producers.set(producer.id, producer);

  producer.on("transportclose", () => {
    peer.producers.delete(producer.id);
  });

  broadcastRoom(room, {
    type: "newProducer",
    peerId: peer.peerId,
    producerId: producer.id,
    kind: "audio",
    appData: { source: "music" },
  });

  return { transport, producer, rtpPort, rtcpPort, ssrc, payloadType };
}

export function closeMusicProducer(channelId: string) {
  const room = getRoom(channelId);
  if (!room) return;
  const peer = room.peers.get(musicBotPeerId(channelId));
  if (!peer) return;

  for (const [id, producer] of [...peer.producers.entries()]) {
    producer.close();
    peer.producers.delete(id);
    broadcastRoom(room, {
      type: "producerClosed",
      peerId: peer.peerId,
      producerId: id,
    });
  }
  for (const transport of peer.transports.values()) {
    transport.close();
  }
  peer.transports.clear();
}

export function removeMusicBotPeer(channelId: string) {
  const room = getRoom(channelId);
  if (!room) return;
  const peerId = musicBotPeerId(channelId);
  const peer = room.peers.get(peerId);
  if (!peer) return;

  for (const producer of peer.producers.values()) producer.close();
  for (const transport of peer.transports.values()) transport.close();
  room.peers.delete(peerId);
  broadcastRoom(room, { type: "peerLeft", peerId });
}
