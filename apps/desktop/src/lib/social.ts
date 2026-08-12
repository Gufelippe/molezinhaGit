import type { PublicProfilePatch, SocialServerMessage, SocialSignal } from "@molezinha/shared";
import { CALLS_URL, supabase } from "./supabase";

export type ProfileUpdatedHandler = (profile: PublicProfilePatch) => void;

function socialWsUrl(): string {
  try {
    const u = new URL(CALLS_URL);
    u.pathname = "/ws/social";
    return u.toString();
  } catch {
    return "ws://127.0.0.1:3001/ws/social";
  }
}

class SocialClient {
  private ws: WebSocket | null = null;
  private ready = false;
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 800;
  private handlers = new Set<ProfileUpdatedHandler>();
  private pendingPublish: PublicProfilePatch | null = null;
  private connectGeneration = 0;
  private opening = false;

  onProfileUpdated(handler: ProfileUpdatedHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async connect() {
    this.intentionalClose = false;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      this.disconnect();
      return;
    }
    this.open(session.access_token);
  }

  disconnect() {
    this.intentionalClose = true;
    this.ready = false;
    this.opening = false;
    this.pendingPublish = null;
    this.connectGeneration += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  publishProfile(profile: PublicProfilePatch) {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingPublish = profile;
      void this.connect();
      return;
    }
    this.send({ type: "profileUpdated", profile });
  }

  private open(token: string) {
    if (this.opening && this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.ready) {
      return;
    }

    const generation = ++this.connectGeneration;
    const prev = this.ws;
    this.ws = null;
    this.ready = false;
    this.opening = true;
    if (prev) {
      try {
        prev.close();
      } catch {
        /* ignore */
      }
    }

    const ws = new WebSocket(socialWsUrl());
    this.ws = ws;

    ws.onopen = () => {
      if (generation !== this.connectGeneration || this.ws !== ws) return;
      this.send({ type: "hello", token });
    };

    ws.onmessage = (ev) => {
      if (generation !== this.connectGeneration || this.ws !== ws) return;
      let msg: SocialServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as SocialServerMessage;
      } catch {
        return;
      }
      if (msg.type === "ready") {
        this.ready = true;
        this.opening = false;
        this.backoffMs = 800;
        if (this.pendingPublish) {
          const profile = this.pendingPublish;
          this.pendingPublish = null;
          this.send({ type: "profileUpdated", profile });
        }
        return;
      }
      if (msg.type === "profileUpdated") {
        for (const h of this.handlers) h(msg.profile);
        return;
      }
      if (msg.type === "error") {
        console.warn("[social]", msg.message);
      }
    };

    ws.onclose = () => {
      if (generation !== this.connectGeneration) return;
      this.ready = false;
      this.opening = false;
      if (this.ws === ws) this.ws = null;
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose handles reconnect
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.intentionalClose) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 12_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, wait);
  }

  private send(msg: SocialSignal) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.warn("[social] send failed", err);
    }
  }
}

export const socialClient = new SocialClient();
