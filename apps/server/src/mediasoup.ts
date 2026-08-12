import * as mediasoup from "mediasoup";
import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  DtlsParameters,
  RtpCapabilities,
  RtpParameters,
} from "mediasoup/types";

const mediaCodecs = [
  {
    kind: "audio" as const,
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video" as const,
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

let worker: Worker | null = null;

export async function getWorker(): Promise<Worker> {
  if (worker) return worker;

  worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: Number(process.env.MEDIASOUP_RTC_MIN_PORT ?? 40000),
    rtcMaxPort: Number(process.env.MEDIASOUP_RTC_MAX_PORT ?? 40100),
  });

  worker.on("died", () => {
    console.error("[mediasoup] worker died — exiting");
    process.exit(1);
  });

  return worker;
}

export function listenIps(): mediasoup.types.TransportListenInfo[] {
  const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP || undefined;
  return [
    {
      protocol: "udp",
      ip: process.env.MEDIASOUP_LISTEN_IP ?? "0.0.0.0",
      announcedAddress: announcedIp,
    },
    {
      protocol: "tcp",
      ip: process.env.MEDIASOUP_LISTEN_IP ?? "0.0.0.0",
      announcedAddress: announcedIp,
    },
  ];
}

export interface PeerState {
  peerId: string;
  userId: string;
  displayName: string;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
  send: (msg: unknown) => void;
}

export interface RoomState {
  channelId: string;
  router: Router;
  peers: Map<string, PeerState>;
}

const rooms = new Map<string, RoomState>();

export async function getOrCreateRoom(channelId: string): Promise<RoomState> {
  const existing = rooms.get(channelId);
  if (existing) return existing;

  const w = await getWorker();
  const router = await w.createRouter({
    mediaCodecs: mediaCodecs as mediasoup.types.RtpCodecCapability[],
  });
  const room: RoomState = { channelId, router, peers: new Map() };
  rooms.set(channelId, room);
  return room;
}

export function getRoom(channelId: string): RoomState | undefined {
  return rooms.get(channelId);
}

export async function createWebRtcTransport(
  room: RoomState
): Promise<WebRtcTransport> {
  return room.router.createWebRtcTransport({
    listenInfos: listenIps(),
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 800000,
  });
}

export async function connectTransport(
  transport: WebRtcTransport,
  dtlsParameters: DtlsParameters
) {
  await transport.connect({ dtlsParameters });
}

export async function produceOnTransport(
  transport: WebRtcTransport,
  kind: "audio" | "video",
  rtpParameters: RtpParameters,
  appData?: Record<string, unknown>
) {
  return transport.produce({ kind, rtpParameters, appData: appData ?? {} });
}

export async function consumeOnTransport(
  room: RoomState,
  transport: WebRtcTransport,
  producerId: string,
  rtpCapabilities: RtpCapabilities
) {
  if (!room.router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error("Cannot consume");
  }
  return transport.consume({
    producerId,
    rtpCapabilities,
    paused: true,
  });
}

export function removePeerFromRoom(channelId: string, peerId: string) {
  const room = rooms.get(channelId);
  if (!room) return;

  const peer = room.peers.get(peerId);
  if (!peer) return;

  for (const consumer of peer.consumers.values()) consumer.close();
  for (const producer of peer.producers.values()) producer.close();
  for (const transport of peer.transports.values()) transport.close();
  room.peers.delete(peerId);

  for (const other of room.peers.values()) {
    other.send({ type: "peerLeft", peerId });
  }

  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(channelId);
  }
}

export type {
  DtlsParameters,
  RtpCapabilities,
  RtpParameters,
  WebRtcTransport,
  Producer,
  Consumer,
};
