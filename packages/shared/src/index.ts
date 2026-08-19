export type ThemePreference = "light" | "dark" | "system";

export type ThemeColorKey =
  | "bg"
  | "bgDeep"
  | "bgElevated"
  | "surface"
  | "text"
  | "textMuted"
  | "accent"
  | "accentBright"
  | "accentSoft"
  | "danger"
  | "dangerSoft"
  | "success"
  | "shadowLight"
  | "shadowDark";

export type ThemeSettings = {
  presetId?: string | null;
  colors?: Partial<Record<ThemeColorKey, string>>;
  radiusPx?: number;
  fontDisplay?: string;
  fontBody?: string;
  /** Hand-picked appearance parked while a base mode or preset is active. */
  saved?: Omit<ThemeSettings, "saved">;
};

export type ChannelType = "text" | "voice" | "announcement";

export type PresenceStatus = "online" | "idle" | "dnd" | "offline" | "in_call";

export type UserActivity = {
  name: string;
  details?: string | null;
  started_at?: string | null;
};

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  banner_url: string | null;
  banner_color: string;
  accent_color: string;
  pronouns: string | null;
  custom_status: string | null;
  theme: ThemePreference;
  theme_settings: ThemeSettings;
  mute_on_join: boolean;
  message_sound: boolean;
  status: PresenceStatus;
  voice_channel_id: string | null;
  dnd_start?: string | null;
  dnd_end?: string | null;
  activity?: UserActivity | null;
  created_at: string;
  updated_at: string;
}

export type PublicProfilePatch = Pick<
  Profile,
  | "id"
  | "username"
  | "display_name"
  | "avatar_url"
  | "bio"
  | "banner_url"
  | "banner_color"
  | "accent_color"
  | "pronouns"
  | "custom_status"
  | "status"
  | "activity"
>;

/** Persistent social WS (profile fanout) — not mediasoup */
export type SocialSignal =
  | { type: "hello"; token: string }
  | { type: "profileUpdated"; profile: PublicProfilePatch };

export type SocialServerMessage =
  | { type: "ready" }
  | { type: "profileUpdated"; profile: PublicProfilePatch }
  | { type: "error"; message: string };

export interface Group {
  id: string;
  name: string;
  icon_url: string | null;
  accent_color?: string;
  wallpaper_url?: string | null;
  invite_code: string;
  invite_expires_at?: string | null;
  invite_max_uses?: number | null;
  invite_use_count?: number;
  owner_id: string;
  created_at: string;
}

export interface Channel {
  id: string;
  group_id: string;
  name: string;
  type: ChannelType;
  position: number;
  is_private: boolean;
  created_at: string;
}

export interface Sticker {
  id: string;
  owner_id: string;
  name: string;
  file_url: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  created_at: string;
}

export type MessageAttachment = {
  id: string;
  message_id?: string | null;
  dm_message_id?: string | null;
  uploader_id: string;
  file_url: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  width?: number | null;
  height?: number | null;
  created_at?: string;
};

export type ForwardedFrom = {
  author_id: string;
  author_display_name: string;
  content: string;
  sticker_id?: string | null;
  source: "channel" | "dm";
};

export type MessageReactionAgg = {
  emoji: string;
  count: number;
  me: boolean;
};

export type MessageReplySnippet = {
  id: string;
  content: string;
  author_id: string;
  sticker_id?: string | null;
  profiles?: Pick<Profile, "id" | "display_name" | "avatar_url" | "username">;
};

export type PollOptionAgg = {
  id: string;
  label: string;
  position: number;
  votes: number;
};

export type MessagePollAgg = {
  id: string;
  question: string;
  options: PollOptionAgg[];
  myOptionId?: string | null;
  totalVotes: number;
};

export interface Message {
  id: string;
  channel_id?: string;
  conversation_id?: string;
  author_id: string;
  content: string;
  sticker_id: string | null;
  created_at: string;
  reply_to_id?: string | null;
  forwarded_from?: ForwardedFrom | null;
  reply_to?: MessageReplySnippet | null;
  reactions?: MessageReactionAgg[];
  pinned?: boolean;
  attachments?: MessageAttachment[];
  poll?: MessagePollAgg | null;
  bookmarked?: boolean;
  profiles?: Pick<Profile, "id" | "display_name" | "avatar_url" | "username">;
  stickers?: Pick<Sticker, "id" | "name" | "file_url"> | null;
}

export interface MessageMention {
  message_id: string;
  mentioned_user_id: string;
  created_at?: string;
}

export interface DmUnreadRow {
  conversation_id: string;
  unread_count: number;
}

export interface ChannelUnreadRow {
  channel_id: string;
  group_id: string;
  unread_count: number;
  mention_count: number;
}

export interface UnreadSummary {
  dms: DmUnreadRow[];
  channels: ChannelUnreadRow[];
}

export interface DirectConversation {
  id: string;
  created_at: string;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  author_id: string;
  content: string;
  sticker_id: string | null;
  created_at: string;
  reply_to_id?: string | null;
  forwarded_from?: ForwardedFrom | null;
  reply_to?: MessageReplySnippet | null;
  reactions?: MessageReactionAgg[];
  attachments?: MessageAttachment[];
  profiles?: Pick<Profile, "id" | "display_name" | "avatar_url" | "username">;
  stickers?: Pick<Sticker, "id" | "name" | "file_url"> | null;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  server_muted: boolean;
  server_deafened: boolean;
}

export type FriendshipStatus = "pending" | "accepted" | "rejected";

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
}

export interface FriendListItem {
  friendship_id: string;
  user: Profile;
}

export type SearchMessageHit = {
  id: string;
  content: string;
  author_id: string;
  created_at: string;
  author_display_name: string;
  author_username: string;
  author_avatar_url: string | null;
};

export type InvitePreview = {
  name: string | null;
  icon_url: string | null;
  accent_color: string | null;
  member_count: number;
  invite_valid: boolean;
};

/** Signaling messages between desktop client and mediasoup server */
export type CallSignal =
  | { type: "join"; channelId: string; token: string }
  | { type: "leave" }
  | { type: "getRouterRtpCapabilities" }
  | { type: "createWebRtcTransport"; direction: "send" | "recv" }
  | {
      type: "connectWebRtcTransport";
      transportId: string;
      dtlsParameters: unknown;
    }
  | {
      type: "produce";
      transportId: string;
      kind: "audio" | "video";
      rtpParameters: unknown;
      appData?: MediaAppData;
    }
  | {
      type: "consume";
      transportId: string;
      producerId: string;
      rtpCapabilities: unknown;
    }
  | { type: "resumeConsumer"; consumerId: string }
  | { type: "closeProducer"; producerId: string }
  | { type: "mute"; kind: "audio" | "video"; muted: boolean }
  | { type: "serverVoiceModeration"; userId: string; muted: boolean; deafened: boolean };

export type CallServerMessage =
  | { type: "joined"; peers: CallPeerInfo[]; routerRtpCapabilities: unknown; voiceModeration?: VoiceModerationState[] }
  | { type: "peerJoined"; peer: CallPeerInfo }
  | { type: "peerLeft"; peerId: string }
  | { type: "routerRtpCapabilities"; routerRtpCapabilities: unknown }
  | {
      type: "transportCreated";
      direction: "send" | "recv";
      id: string;
      iceParameters: unknown;
      iceCandidates: unknown;
      dtlsParameters: unknown;
    }
  | { type: "transportConnected"; transportId: string }
  | {
      type: "produced";
      id: string;
      kind: "audio" | "video";
      appData?: MediaAppData;
    }
  | {
      type: "consumed";
      id: string;
      producerId: string;
      kind: "audio" | "video";
      rtpParameters: unknown;
      peerId: string;
      appData?: MediaAppData;
    }
  | {
      type: "newProducer";
      peerId: string;
      producerId: string;
      kind: "audio" | "video";
      appData?: MediaAppData;
    }
  | { type: "producerClosed"; peerId: string; producerId: string }
  | { type: "peerMute"; peerId: string; kind: "audio" | "video"; muted: boolean }
  | { type: "serverVoiceModeration"; userId: string; muted: boolean; deafened: boolean }
  | { type: "musicState"; state: MusicChannelState }
  | { type: "error"; message: string };

/** Which capture a producer came from — lets peers tell a webcam from a shared screen. */
export type MediaSource = "mic" | "camera" | "screen" | "music";

export type MediaAppData = { source?: MediaSource } & Record<string, unknown>;

export interface CallPeerInfo {
  peerId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  producers: { id: string; kind: "audio" | "video"; appData?: MediaAppData }[];
}

export type VoiceModerationState = {
  userId: string;
  muted: boolean;
  deafened: boolean;
};

/** One queued or playing track for the voice-channel music bot. */
export type MusicTrack = {
  trackId: string;
  url: string;
  title: string;
  requestedBy: string;
  requestedByName: string;
  thumbnail?: string | null;
};

export type MusicChannelState = {
  channelId: string;
  nowPlaying: MusicTrack | null;
  queue: MusicTrack[];
};
