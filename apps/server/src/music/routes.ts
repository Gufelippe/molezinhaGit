import type { FastifyInstance } from "fastify";
import {
  assertChannelMembership,
  verifySupabaseJwt,
} from "../auth.js";
import { getRoom } from "../mediasoup.js";
import {
  enqueueTrack,
  getMusicState,
  removeTrack,
  skipTrack,
  stopChannel,
} from "./queue.js";

async function bearerUser(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token");
  }
  return verifySupabaseJwt(authHeader.slice("Bearer ".length));
}

function isStaff(role: string) {
  return role === "owner" || role === "admin";
}

export async function registerMusicRoutes(app: FastifyInstance) {
  app.get<{ Params: { channelId: string } }>("/music/:channelId/state", async (req, reply) => {
    try {
      const user = await bearerUser(req.headers.authorization);
      await assertChannelMembership(user.userId, req.params.channelId);
      return getMusicState(req.params.channelId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro";
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Params: { channelId: string }; Body: { url?: string } }>(
    "/music/:channelId/play",
    async (req, reply) => {
      try {
        const user = await bearerUser(req.headers.authorization);
        const membership = await assertChannelMembership(user.userId, req.params.channelId);
        const room = getRoom(req.params.channelId);
        if (!room) {
          return reply.code(400).send({ error: "Entre na call antes de pedir música" });
        }
        const url = req.body?.url?.trim();
        if (!url) return reply.code(400).send({ error: "Informe a URL do YouTube" });

        const state = await enqueueTrack({
          channelId: req.params.channelId,
          url,
          userId: user.userId,
          displayName: membership.displayName,
        });
        return state;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro";
        return reply.code(400).send({ error: message });
      }
    }
  );

  app.post<{ Params: { channelId: string } }>("/music/:channelId/skip", async (req, reply) => {
    try {
      const user = await bearerUser(req.headers.authorization);
      const membership = await assertChannelMembership(user.userId, req.params.channelId);
      return skipTrack(req.params.channelId, user.userId, isStaff(membership.role));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro";
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Params: { channelId: string } }>("/music/:channelId/stop", async (req, reply) => {
    try {
      const user = await bearerUser(req.headers.authorization);
      const membership = await assertChannelMembership(user.userId, req.params.channelId);
      const state = getMusicState(req.params.channelId);
      const staff = isStaff(membership.role);
      const ownsNow =
        Boolean(state.nowPlaying) && state.nowPlaying?.requestedBy === user.userId;
      if (!staff && !ownsNow) {
        return reply.code(403).send({ error: "Só quem pediu a faixa (ou um admin) pode parar" });
      }
      return stopChannel(req.params.channelId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro";
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Params: { channelId: string }; Body: { trackId?: string } }>(
    "/music/:channelId/remove",
    async (req, reply) => {
      try {
        const user = await bearerUser(req.headers.authorization);
        const membership = await assertChannelMembership(user.userId, req.params.channelId);
        const trackId = req.body?.trackId?.trim();
        if (!trackId) return reply.code(400).send({ error: "Informe o trackId" });
        return removeTrack(
          req.params.channelId,
          trackId,
          user.userId,
          isStaff(membership.role)
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro";
        return reply.code(400).send({ error: message });
      }
    }
  );
}
