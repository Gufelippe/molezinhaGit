import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { attachCallSocket } from "./signaling.js";
import { attachSocialSocket } from "./social.js";
import { getWorker } from "./mediasoup.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  await getWorker();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/health", async () => ({
    ok: true,
    service: "molezinha-calls",
    announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP ?? null,
  }));

  app.get("/ws", { websocket: true }, (socket) => {
    attachCallSocket(socket);
  });

  app.get("/ws/social", { websocket: true }, (socket) => {
    attachSocialSocket(socket);
  });

  await app.listen({ port, host });
  console.log(`[molezinha-server] listening on ${host}:${port}`);
  console.log(
    `[molezinha-server] mediasoup announced IP: ${process.env.MEDIASOUP_ANNOUNCED_IP ?? "(unset)"}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
