import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { CallSignal, MediaAppData } from "@molezinha/shared";
import {
  assertChannelMembership,
  setVoicePresence,
  verifySupabaseJwt,
} from "./auth.js";
import {
  connectTransport,
  consumeOnTransport,
  createWebRtcTransport,
  getOrCreateRoom,
  removePeerFromRoom,
  type DtlsParameters,
  type PeerState,
  type RtpCapabilities,
  type RtpParameters,
} from "./mediasoup.js";

interface SocketCtx {
  peerId: string;
  channelId: string | null;
  userId: string | null;
}

function send(socket: WebSocket, msg: unknown) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export function attachCallSocket(socket: WebSocket) {
  const ctx: SocketCtx = {
    peerId: randomUUID(),
    channelId: null,
    userId: null,
  };

  socket.on("message", async (raw) => {
    let data: CallSignal;
    try {
      data = JSON.parse(String(raw)) as CallSignal;
    } catch {
      send(socket, { type: "error", message: "Invalid JSON" });
      return;
    }

    try {
      await handleSignal(socket, ctx, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      send(socket, { type: "error", message });
    }
  });

  socket.on("close", async () => {
    if (ctx.channelId) {
      removePeerFromRoom(ctx.channelId, ctx.peerId);
      if (ctx.userId) {
        await setVoicePresence(ctx.userId, null);
      }
    }
  });
}

async function handleSignal(
  socket: WebSocket,
  ctx: SocketCtx,
  data: CallSignal
) {
  if (data.type === "join") {
    const auth = await verifySupabaseJwt(data.token);
    const membership = await assertChannelMembership(auth.userId, data.channelId);
    const room = await getOrCreateRoom(data.channelId);

    // One live session per user in a channel — drop ghost peers from reconnects
    for (const existing of [...room.peers.values()]) {
      if (existing.peerId.startsWith("music:")) continue;
      if (existing.userId === auth.userId) {
        removePeerFromRoom(data.channelId, existing.peerId);
      }
    }

    const peer: PeerState = {
      peerId: ctx.peerId,
      userId: auth.userId,
      displayName: membership.displayName,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      send: (msg) => send(socket, msg),
    };

    room.peers.set(ctx.peerId, peer);
    ctx.channelId = data.channelId;
    ctx.userId = auth.userId;
    await setVoicePresence(auth.userId, data.channelId);

    const peers = [...room.peers.values()]
      .filter((p) => p.peerId !== ctx.peerId)
      .map((p) => ({
        peerId: p.peerId,
        userId: p.userId,
        displayName: p.displayName,
        producers: [...p.producers.values()].map((pr) => ({
          id: pr.id,
          kind: pr.kind as "audio" | "video",
          appData: pr.appData as MediaAppData,
        })),
      }));

    send(socket, {
      type: "joined",
      peers,
      routerRtpCapabilities: room.router.rtpCapabilities,
    });

    try {
      const { getMusicState } = await import("./music/queue.js");
      send(socket, { type: "musicState", state: getMusicState(data.channelId) });
    } catch {
      /* music module optional at boot */
    }

    for (const other of room.peers.values()) {
      if (other.peerId === ctx.peerId) continue;
      if (other.peerId.startsWith("music:")) continue;
      other.send({
        type: "peerJoined",
        peer: {
          peerId: peer.peerId,
          userId: peer.userId,
          displayName: peer.displayName,
          producers: [],
        },
      });
    }
    return;
  }

  if (!ctx.channelId || !ctx.userId) {
    throw new Error("Join a channel first");
  }

  const room = await getOrCreateRoom(ctx.channelId);
  const peer = room.peers.get(ctx.peerId);
  if (!peer) throw new Error("Peer not in room");

  switch (data.type) {
    case "leave": {
      removePeerFromRoom(ctx.channelId, ctx.peerId);
      await setVoicePresence(ctx.userId, null);
      ctx.channelId = null;
      return;
    }
    case "getRouterRtpCapabilities": {
      send(socket, {
        type: "routerRtpCapabilities",
        routerRtpCapabilities: room.router.rtpCapabilities,
      });
      return;
    }
    case "createWebRtcTransport": {
      const transport = await createWebRtcTransport(room);
      peer.transports.set(transport.id, transport);
      send(socket, {
        type: "transportCreated",
        direction: data.direction,
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
      return;
    }
    case "connectWebRtcTransport": {
      const transport = peer.transports.get(data.transportId);
      if (!transport || !("iceParameters" in transport)) throw new Error("Transport not found");
      await connectTransport(transport, data.dtlsParameters as DtlsParameters);
      send(socket, { type: "transportConnected", transportId: transport.id });
      return;
    }
    case "produce": {
      const transport = peer.transports.get(data.transportId);
      if (!transport || !("iceParameters" in transport)) throw new Error("Transport not found");
      const appData: MediaAppData = data.appData ?? {};
      const producer = await transport.produce({
        kind: data.kind,
        rtpParameters: data.rtpParameters as RtpParameters,
        appData,
      });
      peer.producers.set(producer.id, producer);
      producer.on("transportclose", () => {
        peer.producers.delete(producer.id);
      });

      send(socket, { type: "produced", id: producer.id, kind: data.kind, appData });

      for (const other of room.peers.values()) {
        if (other.peerId === peer.peerId) continue;
        if (other.peerId.startsWith("music:")) continue;
        other.send({
          type: "newProducer",
          peerId: peer.peerId,
          producerId: producer.id,
          kind: data.kind,
          appData,
        });
      }
      return;
    }
    case "consume": {
      const transport = peer.transports.get(data.transportId);
      if (!transport || !("iceParameters" in transport)) throw new Error("Transport not found");
      const consumer = await consumeOnTransport(
        room,
        transport,
        data.producerId,
        data.rtpCapabilities as RtpCapabilities
      );
      peer.consumers.set(consumer.id, consumer);

      let ownerPeerId = "";
      let producerAppData: MediaAppData = {};
      for (const p of room.peers.values()) {
        const owned = p.producers.get(data.producerId);
        if (owned) {
          ownerPeerId = p.peerId;
          producerAppData = owned.appData as MediaAppData;
          break;
        }
      }

      send(socket, {
        type: "consumed",
        id: consumer.id,
        producerId: data.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        peerId: ownerPeerId,
        appData: producerAppData,
      });
      return;
    }
    case "resumeConsumer": {
      const consumer = peer.consumers.get(data.consumerId);
      if (!consumer) throw new Error("Consumer not found");
      await consumer.resume();
      return;
    }
    case "closeProducer": {
      const producer = peer.producers.get(data.producerId);
      if (!producer) return;
      producer.close();
      peer.producers.delete(data.producerId);
      for (const other of room.peers.values()) {
        if (other.peerId === peer.peerId) continue;
        other.send({
          type: "producerClosed",
          peerId: peer.peerId,
          producerId: data.producerId,
        });
      }
      return;
    }
    case "mute": {
      for (const other of room.peers.values()) {
        if (other.peerId === peer.peerId) continue;
        other.send({
          type: "peerMute",
          peerId: peer.peerId,
          kind: data.kind,
          muted: data.muted,
        });
      }
      return;
    }
    default:
      throw new Error("Unknown signal");
  }
}
