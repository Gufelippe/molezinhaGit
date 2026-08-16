import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import type {
  Channel,
  Group,
  Message,
  MessageAttachment,
  Profile,
  Sticker,
} from "@molezinha/shared";
import { useAuth } from "./lib/auth";
import { supabase } from "./lib/supabase";
import { callClient } from "./lib/calls";
import { unlockCallSounds } from "./lib/callSounds";
import { musicApi } from "./lib/musicApi";
import { socialClient } from "./lib/social";
import {
  authorCache,
  cacheAuthor,
  cacheAuthors,
  cacheSticker,
  fetchRecentMessages,
  hydrateMessage,
  playMessageBeep,
  uploadMessageAttachments,
  type PendingAttachment,
} from "./lib/chatCache";
import {
  contentMentionsUsername,
  fetchUnreadSummary,
  formatBadgeCount,
  markChannelRead,
  markDmRead,
  readNotifyPrefs,
  shouldUseDesktopNotification,
  type ToastPayload,
} from "./lib/notifications";
import {
  registerGlobalShortcuts,
  showNativeNotification,
  updateWindowBadge,
} from "./lib/desktopNative";
import { startActivityTracking } from "./lib/activity";
import { AuthPage } from "./components/AuthPage";
import { SettingsModal } from "./components/SettingsModal";
import { CallBar } from "./components/CallBar";
import { PromptModal } from "./components/PromptModal";
import { TitleBar } from "./components/TitleBar";
import { GroupSettingsModal } from "./components/GroupSettingsModal";
import { UserPopout } from "./components/UserPopout";
import { ProfilePopout } from "./components/ProfilePopout";
import { MessageList } from "./components/MessageList";
import { ChatComposer } from "./components/ChatComposer";
import { NotificationToasts } from "./components/NotificationToasts";
import { Avatar } from "./components/Avatar";
import { EmptyState } from "./components/EmptyState";
import { SkeletonList } from "./components/Skeleton";
import { NeoTooltip } from "./components/NeoTooltip";
import { PinsPanel } from "./components/PinsPanel";
import { SearchModal } from "./components/SearchModal";
import { BookmarksPanel } from "./components/BookmarksPanel";
import { InvitePreviewModal } from "./components/InvitePreviewModal";
import { PollComposerModal } from "./components/PollComposerModal";
import {
  ForwardDestinationModal,
  type ForwardDestination,
} from "./components/ForwardDestinationModal";
import type { ContextMenuAction } from "./components/MessageContextMenu";
import {
  IconAt,
  IconBell,
  IconBellOff,
  IconBookmark,
  IconCheck,
  IconCopy,
  IconFriends,
  IconHash,
  IconJoin,
  IconMegaphone,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSpeaker,
} from "./components/Icons";
import type { ForwardedFrom } from "@molezinha/shared";

type MutualGroup = { id: string; name: string; icon_url: string | null };

const TYPING_TTL_MS = 4500;
const TYPING_THROTTLE_MS = 2200;
const IDLE_AFTER_MS = 5 * 60 * 1000;

/** Text and announcement channels both render the chat surface. */
function isChatChannel(channel: Channel) {
  return channel.type === "text" || channel.type === "announcement";
}

function noteKey(userId: string) {
  return `molezinha.notes.${userId}`;
}

/** True when now falls inside the profile's configured quiet hours (HH:MM[:SS]). */
function withinDndWindow(start?: string | null, end?: string | null): boolean {
  if (!start || !end) return false;
  const toMinutes = (v: string) => {
    const [h, m] = v.split(":");
    const hours = Number(h);
    const mins = Number(m ?? 0);
    if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
    return hours * 60 + mins;
  };
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  if (s === e) return false;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

type View =
  | { kind: "channel"; channel: Channel }
  | { kind: "dm"; conversationId: string; other: Profile }
  | { kind: "home" };

type DmRecent = {
  conversationId: string;
  other: Profile;
};

type FriendRequest = {
  id: string;
  requester: Profile;
};

type ChannelUnread = { count: number; mentions: number; groupId: string };

/** Accent bar that slides between the active channel/DM rows. */
function NavMarker() {
  return (
    <motion.span
      className="channel-active-marker"
      layoutId="nav-marker"
      transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.7 }}
      aria-hidden
    />
  );
}

export default function App() {
  const { session, profile, loading, user, updateProfile } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"account" | "profile" | "appearance" | "voice" | "notifications">("account");
  const [userPopoutOpen, setUserPopoutOpen] = useState(false);
  const [memberPopoutId, setMemberPopoutId] = useState<string | null>(null);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<(Profile & { role?: string })[]>([]);
  const [myRole, setMyRole] = useState<"owner" | "admin" | "member">("member");
  const [view, setView] = useState<View>({ kind: "home" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwardSource, setForwardSource] = useState<Message | null>(null);
  const [forwardChannels, setForwardChannels] = useState<Channel[]>([]);
  /** First unread message timestamp — Discord-style NOVO divider while staying in chat */
  const [unreadSince, setUnreadSince] = useState<string | null>(null);
  const [error, setErrorState] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageSoundRef = useRef(true);

  const setError = useCallback((msg: string | null) => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setErrorState(msg);
    if (msg) {
      errorTimerRef.current = setTimeout(() => {
        setErrorState(null);
        errorTimerRef.current = null;
      }, 3500);
    }
  }, []);
  const [inVoice, setInVoice] = useState(false);
  const [voiceChannel, setVoiceChannel] = useState<Channel | null>(null);
  const [joiningVoice, setJoiningVoice] = useState(false);
  const [promptKind, setPromptKind] = useState<"create" | "addFriend" | null>(null);
  const [memberModeration, setMemberModeration] = useState<{
    userId: string;
    name: string;
    ban: boolean;
  } | null>(null);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [friends, setFriends] = useState<Profile[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [dmRecents, setDmRecents] = useState<DmRecent[]>([]);
  const [dmUnread, setDmUnread] = useState<Map<string, number>>(() => new Map());
  const [channelUnread, setChannelUnread] = useState<Map<string, ChannelUnread>>(
    () => new Map()
  );
  const [toasts, setToasts] = useState<ToastPayload[]>([]);
  const [savedStickerIds, setSavedStickerIds] = useState<Set<string>>(() => new Set());
  const [pinsOpen, setPinsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [mentionsOnly, setMentionsOnly] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [typingPeers, setTypingPeers] = useState<Map<string, { name: string; at: number }>>(
    () => new Map()
  );
  const [mutedChannelIds, setMutedChannelIds] = useState<Set<string>>(() => new Set());
  const [mutedGroupIds, setMutedGroupIds] = useState<Set<string>>(() => new Set());
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(() => new Set());
  const [mutualGroups, setMutualGroups] = useState<MutualGroup[]>([]);
  const [memberNote, setMemberNote] = useState("");
  const userPanelRef = useRef<HTMLDivElement>(null);
  const memberAnchorRef = useRef<HTMLElement | null>(null);
  const memberRowRefs = useRef(new Map<string, HTMLElement>());
  const viewRef = useRef(view);
  const groupsRef = useRef(groups);
  const dmRecentsRef = useRef(dmRecents);
  const channelsRef = useRef(channels);
  const unreadSinceRef = useRef<string | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef(0);
  const mutedChannelsRef = useRef(mutedChannelIds);
  const mutedGroupsRef = useRef(mutedGroupIds);
  const quietModeRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOnlineRef = useRef(true);
  const pushToTalkPreviousMuteRef = useRef<boolean | null>(null);

  viewRef.current = view;
  groupsRef.current = groups;
  dmRecentsRef.current = dmRecents;
  channelsRef.current = channels;
  unreadSinceRef.current = unreadSince;
  mutedChannelsRef.current = mutedChannelIds;
  mutedGroupsRef.current = mutedGroupIds;
  messageSoundRef.current = profile?.message_sound !== false;

  const quietMode =
    profile?.status === "dnd" || withinDndWindow(profile?.dnd_start, profile?.dnd_end);
  quietModeRef.current = quietMode;

  const popMember = useMemo(
    () => members.find((m) => m.id === memberPopoutId) ?? null,
    [members, memberPopoutId]
  );

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  const loadGroups = useCallback(async () => {
    if (!user) return;
    const { data: memberships } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id);
    const ids = (memberships ?? []).map((m: { group_id: string }) => m.group_id);
    if (!ids.length) {
      setGroups([]);
      return;
    }
    const { data } = await supabase.from("groups").select("*").in("id", ids);
    setGroups((data as Group[]) ?? []);
  }, [user]);

  const loadFriends = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("friendships")
      .select("requester_id, addressee_id, status")
      .eq("status", "accepted")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    const ids = new Set<string>();
    for (const row of data ?? []) {
      const r = row as { requester_id: string; addressee_id: string };
      ids.add(r.requester_id === user.id ? r.addressee_id : r.requester_id);
    }
    setFriendIds(ids);
    if (!ids.size) {
      setFriends([]);
      return;
    }
    const { data: profiles } = await supabase
      .from("profiles")
      .select(
        "id, username, display_name, avatar_url, status, custom_status, activity, bio, pronouns, banner_url, banner_color, accent_color"
      )
      .in("id", [...ids]);
    const list = ((profiles ?? []) as Profile[]).slice().sort((a, b) =>
      a.display_name.localeCompare(b.display_name, "pt", { sensitivity: "base" })
    );
    setFriends(list);
  }, [user]);

  const loadFriendRequests = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("friendships")
      .select("id, requester_id, created_at")
      .eq("status", "pending")
      .eq("addressee_id", user.id)
      .order("created_at", { ascending: false });

    const rows = (data ?? []) as { id: string; requester_id: string }[];
    if (!rows.length) {
      setFriendRequests([]);
      return;
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select(
        "id, username, display_name, avatar_url, status, custom_status, activity, bio, pronouns, banner_url, banner_color, accent_color"
      )
      .in(
        "id",
        rows.map((r) => r.requester_id)
      );
    const byId = new Map(((profiles ?? []) as Profile[]).map((p) => [p.id, p]));

    setFriendRequests(
      rows.flatMap((r) => {
        const requester = byId.get(r.requester_id);
        return requester ? [{ id: r.id, requester }] : [];
      })
    );
  }, [user]);

  const loadDmRecents = useCallback(async () => {
    if (!user) return;
    const { data: memberships } = await supabase
      .from("direct_conversation_members")
      .select("conversation_id")
      .eq("user_id", user.id);
    const convIds = (memberships ?? []).map(
      (m: { conversation_id: string }) => m.conversation_id
    );
    if (!convIds.length) {
      setDmRecents([]);
      return;
    }
    const { data: others } = await supabase
      .from("direct_conversation_members")
      .select("conversation_id, user_id, profiles(id, display_name, avatar_url, username, status, custom_status, activity, bio, pronouns, banner_url, banner_color, accent_color)")
      .in("conversation_id", convIds)
      .neq("user_id", user.id);

    const recents: DmRecent[] = [];
    for (const row of others ?? []) {
      const raw = row as unknown as {
        conversation_id: string;
        profiles: Profile | Profile[] | null;
      };
      const p = Array.isArray(raw.profiles) ? raw.profiles[0] : raw.profiles;
      if (p) {
        recents.push({ conversationId: raw.conversation_id, other: p });
      }
    }
    setDmRecents(recents);
  }, [user]);

  const loadUnread = useCallback(async () => {
    const summary = await fetchUnreadSummary();
    setDmUnread(new Map(summary.dms.map((d) => [d.conversation_id, d.unread_count])));
    setChannelUnread(
      new Map(
        summary.channels.map((c) => [
          c.channel_id,
          { count: c.unread_count, mentions: c.mention_count, groupId: c.group_id },
        ])
      )
    );
  }, []);

  const loadSavedStickers = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_stickers")
      .select("sticker_id")
      .eq("user_id", user.id);
    if (data) {
      setSavedStickerIds(new Set(data.map((r: { sticker_id: string }) => r.sticker_id)));
    }
  }, [user]);

  const loadMutes = useCallback(async () => {
    if (!user) return;
    const [{ data: chMutes }, { data: grMutes }] = await Promise.all([
      supabase.from("channel_mutes").select("channel_id").eq("user_id", user.id),
      supabase.from("group_mutes").select("group_id").eq("user_id", user.id),
    ]);
    setMutedChannelIds(
      new Set((chMutes ?? []).map((r: { channel_id: string }) => r.channel_id))
    );
    setMutedGroupIds(new Set((grMutes ?? []).map((r: { group_id: string }) => r.group_id)));
  }, [user]);

  const loadBookmarkIds = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_bookmarks")
      .select("message_id, dm_message_id")
      .eq("user_id", user.id);
    const ids = new Set<string>();
    for (const row of (data ?? []) as {
      message_id: string | null;
      dm_message_id: string | null;
    }[]) {
      if (row.message_id) ids.add(row.message_id);
      if (row.dm_message_id) ids.add(row.dm_message_id);
    }
    setBookmarkedIds(ids);
  }, [user]);

  const saveSticker = useCallback(
    async (stickerId: string) => {
      const { data, error } = await supabase.rpc("save_sticker", {
        p_sticker_id: stickerId,
      });
      if (error) {
        setError(error.message);
        return;
      }
      setSavedStickerIds((prev) => new Set(prev).add(stickerId));
      if (data) cacheSticker(data as Sticker);
    },
    [setError]
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<ToastPayload, "id">) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5500);
  }, []);

  const notifyIncoming = useCallback(
    (opts: {
      kind: "dm" | "mention" | "channel";
      title: string;
      body: string;
      avatarUrl?: string | null;
      channelId?: string | null;
      groupId?: string | null;
      onOpen: () => void;
    }) => {
      const prefs = readNotifyPrefs();
      if (opts.kind === "dm" && !prefs.dms) return;
      if (opts.kind === "mention" && !prefs.mentions) return;
      if (opts.kind === "channel" && !prefs.dms && !prefs.mentions) return;

      if (opts.channelId && mutedChannelsRef.current.has(opts.channelId)) return;
      if (opts.groupId && mutedGroupsRef.current.has(opts.groupId)) return;

      // Do-not-disturb silences everything except mentions (when mentions are on).
      if (quietModeRef.current && !(opts.kind === "mention" && prefs.mentions)) return;

      if (messageSoundRef.current) playMessageBeep();

      const useDesktop = prefs.desktop && shouldUseDesktopNotification();
      if (useDesktop) {
        void showNativeNotification({
          title: opts.title,
          body: opts.body,
          onClick: opts.onOpen,
        });
      } else {
        pushToast({
          kind: opts.kind,
          title: opts.title,
          body: opts.body,
          avatarUrl: opts.avatarUrl,
          onOpen: opts.onOpen,
        });
      }
    },
    [pushToast]
  );

  useEffect(() => {
    if (session) {
      void loadGroups();
      void loadFriends();
      void loadFriendRequests();
      void loadDmRecents();
      void loadUnread();
      void loadSavedStickers();
      void loadMutes();
      void loadBookmarkIds();
    }
  }, [
    session,
    loadGroups,
    loadFriends,
    loadFriendRequests,
    loadDmRecents,
    loadUnread,
    loadSavedStickers,
    loadMutes,
    loadBookmarkIds,
  ]);

  // Realtime can drop while the app sleeps — resync on focus.
  useEffect(() => {
    if (!session) return;
    const onFocus = () => {
      void loadUnread();
      void loadFriendRequests();
      void loadFriends();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [session, loadUnread, loadFriendRequests, loadFriends]);

  // Keep friendIds / pending requests fresh for DM / profile actions
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`friendships-app:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friendships" },
        () => {
          void loadFriends();
          void loadFriendRequests();
          void loadDmRecents();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, loadFriends, loadFriendRequests, loadDmRecents]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`membership-self:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "group_members",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const groupId = (payload.old as { group_id?: string } | undefined)?.group_id;
          if (!groupId) return;
          const groupName =
            groupsRef.current.find((g) => g.id === groupId)?.name ?? "um servidor";
          setGroups((prev) => prev.filter((g) => g.id !== groupId));
          if (activeGroupId === groupId) {
            setGroupSettingsOpen(false);
            setMemberPopoutId(null);
            setActiveGroupId(null);
            setChannels([]);
            setMembers([]);
            setView({ kind: "home" });
          }
          if (inVoice && voiceChannel?.group_id === groupId) {
            void callClient.leave();
            setInVoice(false);
            setVoiceChannel(null);
          }
          pushToast({
            kind: "channel",
            title: "Removido do servidor",
            body: `Você não faz mais parte de ${groupName}.`,
            onOpen: () => undefined,
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, activeGroupId, inVoice, voiceChannel, pushToast]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // Mark read when opening a chat (skip while user has a local unread divider)
  useEffect(() => {
    if (!user) return;
    if (unreadSince) return;
    if (view.kind === "channel" && isChatChannel(view.channel)) {
      const id = view.channel.id;
      void markChannelRead(id).then(() => {
        setChannelUnread((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      });
    } else if (view.kind === "dm") {
      const id = view.conversationId;
      void markDmRead(id).then(() => {
        setDmUnread((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      });
    }
  }, [
    user,
    unreadSince,
    view.kind === "channel" ? view.channel.id : null,
    view.kind === "dm" ? view.conversationId : null,
  ]);

  // Global realtime for unread / toasts (beyond the open chat)
  useEffect(() => {
    if (!user) return;
    const myId = user.id;
    const myUsername = profile?.username ?? "";

    const sub = supabase
      .channel(`inbox:${myId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages" },
        (payload: { new: Message & { conversation_id?: string } }) => {
          const row = payload.new;
          const convId = row.conversation_id;
          if (!convId || row.author_id === myId) return;
          const v = viewRef.current;
          const viewing =
            v.kind === "dm" && v.conversationId === convId;
          if (viewing) {
            if (!unreadSinceRef.current) void markDmRead(convId);
            return;
          }
          setDmUnread((prev) => {
            const next = new Map(prev);
            next.set(convId, (next.get(convId) ?? 0) + 1);
            return next;
          });
          const dm = dmRecentsRef.current.find((d) => d.conversationId === convId);
          const title = dm?.other.display_name ?? "Mensagem direta";
          const body = row.content?.slice(0, 120) || "Nova mensagem";
          notifyIncoming({
            kind: "dm",
            title,
            body,
            avatarUrl: dm?.other.avatar_url,
            onOpen: () => {
              if (dm) {
                setActiveGroupId(null);
                setView({
                  kind: "dm",
                  conversationId: convId,
                  other: dm.other,
                });
              }
            },
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload: { new: Message }) => {
          const row = payload.new;
          const channelId = row.channel_id;
          if (!channelId || row.author_id === myId) return;
          const v = viewRef.current;
          const viewing = v.kind === "channel" && v.channel.id === channelId;
          if (viewing) {
            if (!unreadSinceRef.current) void markChannelRead(channelId);
            return;
          }

          let mentioned = contentMentionsUsername(row.content ?? "", myUsername);
          if (!mentioned) {
            const { data } = await supabase
              .from("message_mentions")
              .select("mentioned_user_id")
              .eq("message_id", row.id)
              .eq("mentioned_user_id", myId)
              .maybeSingle();
            mentioned = Boolean(data);
          }

          setChannelUnread((prev) => {
            const next = new Map(prev);
            const chMeta =
              channelsRef.current.find((c) => c.id === channelId) ?? null;
            const cur = next.get(channelId) ?? {
              count: 0,
              mentions: 0,
              groupId: chMeta?.group_id ?? "",
            };
            next.set(channelId, {
              count: cur.count + 1,
              mentions: cur.mentions + (mentioned ? 1 : 0),
              groupId: cur.groupId || chMeta?.group_id || "",
            });
            return next;
          });

          const ch = channelsRef.current.find((c) => c.id === channelId) ?? null;
          const group =
            groupsRef.current.find((g) => g.id === ch?.group_id) ?? null;
          const authorName =
            authorCache.get(row.author_id)?.display_name ??
            row.profiles?.display_name ??
            "Alguém";

          if (mentioned) {
            notifyIncoming({
              kind: "mention",
              title: `${authorName} mencionou você`,
              body: `#${ch?.name ?? "canal"} · ${(row.content ?? "").slice(0, 100)}`,
              avatarUrl: row.profiles?.avatar_url,
              channelId,
              groupId: ch?.group_id ?? group?.id ?? null,
              onOpen: () => {
                if (ch) {
                  setActiveGroupId(ch.group_id);
                  setView({ kind: "channel", channel: ch });
                } else if (group) {
                  setActiveGroupId(group.id);
                }
              },
            });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(sub);
    };
  }, [user, profile?.username, notifyIncoming]);

  const reloadChannels = useCallback(async () => {
    if (!activeGroupId) return;
    const { data: ch } = await supabase
      .from("channels")
      .select("*")
      .eq("group_id", activeGroupId)
      .order("position");
    setChannels((ch as Channel[]) ?? []);
  }, [activeGroupId]);

  useEffect(() => {
    if (!activeGroupId || !user) {
      setChannels([]);
      setMembers([]);
      setMyRole("member");
      return;
    }
    void (async () => {
      const [{ data: ch }, { data: mem }] = await Promise.all([
        supabase
          .from("channels")
          .select("*")
          .eq("group_id", activeGroupId)
          .order("position"),
        supabase
          .from("group_members")
          .select("user_id, role, profiles(id, display_name, avatar_url, username, status, custom_status, activity, bio, pronouns, banner_url, banner_color, accent_color)")
          .eq("group_id", activeGroupId),
      ]);
      setChannels((ch as Channel[]) ?? []);
      const rows = (mem ?? []) as {
        user_id: string;
        role: "owner" | "admin" | "member";
        profiles: Profile | Profile[] | null;
      }[];
      const profiles = rows.map((m) => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
        return p ? { ...p, role: m.role } : null;
      }).filter(Boolean) as (Profile & { role: string })[];
      setMembers(profiles);
      cacheAuthors(profiles);
      const mine = rows.find((r) => r.user_id === user.id);
      setMyRole(mine?.role ?? "member");
      const firstText = ((ch as Channel[]) ?? []).find(isChatChannel);
      if (firstText) {
        setView({ kind: "channel", channel: firstText });
      }
    })();
  }, [activeGroupId, user]);

  function goHome() {
    setActiveGroupId(null);
    setView({ kind: "home" });
  }

  function selectGroup(groupId: string) {
    setMemberPopoutId(null);
    memberAnchorRef.current = null;
    setActiveGroupId(groupId);
  }

  const memberIdsKey = useMemo(
    () =>
      members
        .map((m) => m.id)
        .sort()
        .join(","),
    [members]
  );

  useEffect(() => {
    if (!activeGroupId || !memberIdsKey) return;
    const sub = supabase
      .channel(`presence:${activeGroupId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=in.(${memberIdsKey})`,
        },
        (payload: { new: Profile }) => {
          const updated = payload.new;
          cacheAuthor(updated);
          setMembers((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          );
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(sub);
    };
  }, [activeGroupId, memberIdsKey]);

  useEffect(() => {
    if (profile) cacheAuthor(profile);
  }, [profile]);

  // Ctrl/Cmd+K opens search for whatever chat is on screen.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const v = viewRef.current;
        if (v.kind === "dm" || (v.kind === "channel" && isChatChannel(v.channel))) {
          setSearchOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  // Mutual groups + private note travel with the member popout.
  useEffect(() => {
    if (!memberPopoutId || memberPopoutId === user?.id) {
      setMutualGroups([]);
      setMemberNote("");
      return;
    }
    const target = memberPopoutId;
    setMemberNote(localStorage.getItem(noteKey(target)) ?? "");
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.rpc("mutual_groups", { p_other: target });
      if (!cancelled) setMutualGroups((data as MutualGroup[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [memberPopoutId, user?.id]);

  /** Calling someone means hopping into their voice channel, or the group's first one. */
  const callTargetFor = useCallback(
    (member: Profile) =>
      channels.find((c) => c.type === "voice" && c.id === member.voice_channel_id) ??
      channels.find((c) => c.type === "voice") ??
      null,
    [channels]
  );

  const saveMemberNote = useCallback((userId: string, note: string) => {
    setMemberNote(note);
    if (note.trim()) localStorage.setItem(noteKey(userId), note);
    else localStorage.removeItem(noteKey(userId));
  }, []);

  useEffect(() => {
    // Never keep mic/cam open just because the window opened.
    callClient.releaseMediaDevices();
    const onUnload = () => {
      void callClient.leave();
      callClient.releaseMediaDevices();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      void callClient.leave();
      callClient.releaseMediaDevices();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      socialClient.disconnect();
      return;
    }
    void socialClient.connect();
    const unsub = socialClient.onProfileUpdated((patch) => {
      cacheAuthor(patch);
      setMembers((prev) =>
        prev.map((m) => (m.id === patch.id ? { ...m, ...patch } : m))
      );
      setDmRecents((prev) =>
        prev.map((dm) =>
          dm.other.id === patch.id ? { ...dm, other: { ...dm.other, ...patch } } : dm
        )
      );
    });
    return () => {
      unsub();
      socialClient.disconnect();
    };
  }, [session]);

  useEffect(() => {
    setReplyTo(null);
    setForwardSource(null);
    setUnreadSince(null);
    setPinsOpen(false);
    setSearchOpen(false);
    setHighlightMessageId(null);
    setTypingPeers(new Map());
  }, [
    view.kind === "channel" ? view.channel.id : view.kind === "dm" ? view.conversationId : "home",
  ]);

  /** Attachments land a beat after their message, so patch them in when they arrive. */
  const applyAttachmentRow = useCallback((row: MessageAttachment) => {
    const targetId = row.message_id ?? row.dm_message_id;
    if (!targetId) return;
    setMessages((prev) => {
      if (!prev.some((m) => m.id === targetId)) return prev;
      return prev.map((m) => {
        if (m.id !== targetId) return m;
        const existing = m.attachments ?? [];
        if (existing.some((a) => a.id === row.id)) return m;
        return { ...m, attachments: [...existing, row] };
      });
    });
  }, []);

  useEffect(() => {
    if (view.kind !== "channel") return;
    const channelId = view.channel.id;
    let cancelled = false;
    setMessagesLoading(true);

    void (async () => {
      const rows = await fetchRecentMessages(
        "messages",
        "channel_id",
        channelId,
        user?.id
      );
      if (cancelled) return;
      setMessages(rows);
      setMessagesLoading(false);
    })();

    const sub = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          void hydrateMessage(payload.new as Message, {
            myUserId: user?.id,
            kind: "channel",
          }).then((msg) => {
            if (cancelled) return;
            setMessages((prev) => {
              const existing = prev.find((m) => m.id === msg.id);
              if (existing) {
                return prev.map((m) =>
                  m.id === msg.id
                    ? {
                        ...msg,
                        reactions: m.reactions ?? msg.reactions ?? [],
                        attachments: m.attachments?.length
                          ? m.attachments
                          : msg.attachments ?? [],
                        poll: m.poll ?? msg.poll ?? null,
                        pinned: m.pinned ?? msg.pinned,
                      }
                    : m
                );
              }
              return [...prev, { ...msg, reactions: msg.reactions ?? [] }];
            });
            if (
              msg.author_id !== user?.id &&
              messageSoundRef.current &&
              !quietModeRef.current
            ) {
              playMessageBeep();
            }
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (cancelled || !id) return;
          setMessages((prev) => {
            if (!prev.some((m) => m.id === id)) return prev;
            return prev.filter((m) => m.id !== id);
          });
          setReplyTo((r) => (r?.id === id ? null : r));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => {
          const row = payload.new as { message_id: string; user_id: string; emoji: string };
          if (!row?.message_id) return;
          setMessages((prev) => {
            if (!prev.some((m) => m.id === row.message_id)) return prev;
            return prev.map((m) => {
              if (m.id !== row.message_id) return m;
              let next = [...(m.reactions ?? [])];
              const existing = next.find((r) => r.emoji === row.emoji);
              // Skip if optimistic update already applied for this user
              if (existing && row.user_id === user?.id && existing.me) return m;
              if (existing) {
                next = next.map((r) =>
                  r.emoji === row.emoji
                    ? { ...r, count: r.count + 1, me: r.me || row.user_id === user?.id }
                    : r
                );
              } else {
                next = [...next, { emoji: row.emoji, count: 1, me: row.user_id === user?.id }];
              }
              return { ...m, reactions: next };
            });
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => {
          const row = payload.old as { message_id: string; user_id: string; emoji: string };
          if (!row?.message_id) return;
          setMessages((prev) => {
            if (!prev.some((m) => m.id === row.message_id)) return prev;
            return prev.map((m) => {
              if (m.id !== row.message_id) return m;
              const existing = (m.reactions ?? []).find((r) => r.emoji === row.emoji);
              // Already applied optimistic remove for self
              if (row.user_id === user?.id && existing && !existing.me) return m;
              if (row.user_id === user?.id && !existing) return m;
              const next = (m.reactions ?? [])
                .map((r) => {
                  if (r.emoji !== row.emoji) return r;
                  return {
                    ...r,
                    count: Math.max(0, r.count - 1),
                    me: row.user_id === user?.id ? false : r.me,
                  };
                })
                .filter((r) => r.count > 0);
              return { ...m, reactions: next };
            });
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_attachments" },
        (payload) => {
          if (cancelled) return;
          applyAttachmentRow(payload.new as MessageAttachment);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_poll_votes" },
        (payload) => {
          if (cancelled) return;
          const row = (payload.new ?? payload.old) as {
            poll_id?: string;
            option_id?: string;
            user_id?: string;
          } | null;
          const pollId = row?.poll_id;
          if (!pollId) return;
          // Refresh vote aggregates for this poll from the DB.
          void (async () => {
            const { data: votes } = await supabase
              .from("message_poll_votes")
              .select("option_id, user_id")
              .eq("poll_id", pollId);
            if (cancelled) return;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.poll?.id !== pollId) return m;
                const vlist = votes ?? [];
                const my = user?.id
                  ? vlist.find((v) => v.user_id === user.id)?.option_id ?? null
                  : null;
                return {
                  ...m,
                  poll: {
                    ...m.poll,
                    myOptionId: my,
                    totalVotes: vlist.length,
                    options: m.poll.options.map((o) => ({
                      ...o,
                      votes: vlist.filter((v) => v.option_id === o.id).length,
                    })),
                  },
                };
              })
            );
          })();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_pins",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const id = (payload.new as { message_id?: string })?.message_id;
          if (!id) return;
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, pinned: true } : m)));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "channel_pins",
        },
        (payload) => {
          const id = (payload.old as { message_id?: string })?.message_id;
          if (!id) return;
          setMessages((prev) => {
            if (!prev.some((m) => m.id === id)) return prev;
            return prev.map((m) => (m.id === id ? { ...m, pinned: false } : m));
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(sub);
    };
  }, [view.kind === "channel" ? view.channel.id : null, user?.id]);

  useEffect(() => {
    if (view.kind !== "dm") return;
    const conversationId = view.conversationId;
    cacheAuthor(view.other);
    let cancelled = false;
    setMessagesLoading(true);

    void (async () => {
      const rows = await fetchRecentMessages(
        "direct_messages",
        "conversation_id",
        conversationId,
        user?.id
      );
      if (cancelled) return;
      setMessages(rows);
      setMessagesLoading(false);
    })();

    const sub = supabase
      .channel(`dms:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          void hydrateMessage(payload.new as Message, {
            myUserId: user?.id,
            kind: "dm",
          }).then((msg) => {
            if (cancelled) return;
            setMessages((prev) => {
              const existing = prev.find((m) => m.id === msg.id);
              if (existing) {
                return prev.map((m) =>
                  m.id === msg.id
                    ? {
                        ...msg,
                        reactions: m.reactions ?? msg.reactions ?? [],
                        attachments: m.attachments?.length
                          ? m.attachments
                          : msg.attachments ?? [],
                      }
                    : m
                );
              }
              return [...prev, { ...msg, reactions: msg.reactions ?? [] }];
            });
            if (
              msg.author_id !== user?.id &&
              messageSoundRef.current &&
              !quietModeRef.current
            ) {
              playMessageBeep();
            }
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "direct_messages",
        },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (cancelled || !id) return;
          setMessages((prev) => {
            if (!prev.some((m) => m.id === id)) return prev;
            return prev.filter((m) => m.id !== id);
          });
          setReplyTo((r) => (r?.id === id ? null : r));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_attachments" },
        (payload) => {
          if (cancelled) return;
          applyAttachmentRow(payload.new as MessageAttachment);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_message_reactions" },
        (payload) => {
          const row = payload.new as { message_id: string; user_id: string; emoji: string };
          if (!row?.message_id) return;
          setMessages((prev) => {
            if (!prev.some((m) => m.id === row.message_id)) return prev;
            return prev.map((m) => {
              if (m.id !== row.message_id) return m;
              let next = [...(m.reactions ?? [])];
              const existing = next.find((r) => r.emoji === row.emoji);
              if (existing && row.user_id === user?.id && existing.me) return m;
              if (existing) {
                next = next.map((r) =>
                  r.emoji === row.emoji
                    ? { ...r, count: r.count + 1, me: r.me || row.user_id === user?.id }
                    : r
                );
              } else {
                next = [...next, { emoji: row.emoji, count: 1, me: row.user_id === user?.id }];
              }
              return { ...m, reactions: next };
            });
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "dm_message_reactions" },
        (payload) => {
          const row = payload.old as { message_id: string; user_id: string; emoji: string };
          if (!row?.message_id) return;
          setMessages((prev) => {
            if (!prev.some((m) => m.id === row.message_id)) return prev;
            return prev.map((m) => {
              if (m.id !== row.message_id) return m;
              const existing = (m.reactions ?? []).find((r) => r.emoji === row.emoji);
              if (row.user_id === user?.id && existing && !existing.me) return m;
              if (row.user_id === user?.id && !existing) return m;
              const next = (m.reactions ?? [])
                .map((r) => {
                  if (r.emoji !== row.emoji) return r;
                  return {
                    ...r,
                    count: Math.max(0, r.count - 1),
                    me: row.user_id === user?.id ? false : r.me,
                  };
                })
                .filter((r) => r.count > 0);
              return { ...m, reactions: next };
            });
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(sub);
    };
  }, [view.kind === "dm" ? view.conversationId : null, user?.id]);

  const typingScopeId =
    view.kind === "channel"
      ? view.channel.id
      : view.kind === "dm"
        ? view.conversationId
        : null;

  // Ephemeral "digitando…" fanout for the chat currently on screen.
  useEffect(() => {
    if (!typingScopeId || !user) {
      typingChannelRef.current = null;
      return;
    }
    const myId = user.id;
    const ch = supabase.channel(`typing:${typingScopeId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "typing" }, (payload) => {
      const data = payload.payload as { userId?: string; name?: string };
      if (!data?.userId || data.userId === myId) return;
      setTypingPeers((prev) => {
        const next = new Map(prev);
        next.set(data.userId!, { name: data.name ?? "Alguém", at: Date.now() });
        return next;
      });
    }).subscribe();
    typingChannelRef.current = ch;

    const prune = window.setInterval(() => {
      setTypingPeers((prev) => {
        if (!prev.size) return prev;
        const cutoff = Date.now() - TYPING_TTL_MS;
        let changed = false;
        const next = new Map(prev);
        for (const [id, info] of prev) {
          if (info.at < cutoff) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1500);

    return () => {
      window.clearInterval(prune);
      typingChannelRef.current = null;
      setTypingPeers(new Map());
      void supabase.removeChannel(ch);
    };
  }, [typingScopeId, user?.id]);

  const emitTyping = useCallback(() => {
    const ch = typingChannelRef.current;
    if (!ch || !user) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    void ch.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: user.id, name: profile?.display_name ?? "Alguém" },
    });
  }, [user?.id, profile?.display_name]);

  const typingNames = useMemo(
    () => [...typingPeers.values()].map((t) => t.name),
    [typingPeers]
  );

  // Auto-idle after five minutes without focus; back to online when the user returns.
  useEffect(() => {
    if (!user || !profile) return;
    const status = profile.status;
    if (status === "online") wasOnlineRef.current = true;
    if (status === "dnd" || status === "in_call") return;

    const clearTimer = () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };

    const scheduleIdle = () => {
      clearTimer();
      idleTimerRef.current = setTimeout(() => {
        if (!wasOnlineRef.current) return;
        void updateProfile({ status: "idle" }).catch(() => undefined);
      }, IDLE_AFTER_MS);
    };

    const onAway = () => scheduleIdle();
    const onBack = () => {
      clearTimer();
      if (status === "idle" && wasOnlineRef.current) {
        void updateProfile({ status: "online" }).catch(() => undefined);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") onAway();
      else onBack();
    };

    window.addEventListener("blur", onAway);
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "hidden" || !document.hasFocus()) scheduleIdle();

    return () => {
      clearTimer();
      window.removeEventListener("blur", onAway);
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, profile?.status, updateProfile]);

  const clearUnreadDivider = useCallback(async () => {
    setUnreadSince(null);
    if (view.kind === "channel" && isChatChannel(view.channel)) {
      const id = view.channel.id;
      await markChannelRead(id);
      setChannelUnread((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    } else if (view.kind === "dm") {
      const id = view.conversationId;
      await markDmRead(id);
      setDmUnread((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }
  }, [view]);

  const attachToMessage = useCallback(
    async (messageId: string, kind: "channel" | "dm", files: PendingAttachment[]) => {
      if (!user || !files.length) return;
      try {
        const uploaded = await uploadMessageAttachments(user.id, messageId, kind, files);
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, attachments: uploaded } : m))
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao enviar anexo");
      } finally {
        for (const f of files) URL.revokeObjectURL(f.previewUrl);
      }
    },
    [user, setError]
  );

  const sendMessage = useCallback(
    async (
      content: string,
      mentionedUserIds: string[] = [],
      replyToId: string | null = null,
      attachments?: PendingAttachment[]
    ) => {
      if (!user) return;
      const files = attachments ?? [];
      const body = content.trim() || (files.length ? "📎" : "");
      if (!body) return;
      const replyPayload = replyToId ? { reply_to_id: replyToId } : {};
      if (view.kind === "channel") {
        const { data, error: err } = await supabase
          .from("messages")
          .insert({
            channel_id: view.channel.id,
            author_id: user.id,
            content: body,
            ...replyPayload,
          })
          .select("id")
          .single();
        if (err) {
          setError(err.message);
          for (const f of files) URL.revokeObjectURL(f.previewUrl);
          return;
        }
        setReplyTo(null);
        if (unreadSinceRef.current) void clearUnreadDivider();
        if (data?.id && mentionedUserIds.length) {
          const rows = [...new Set(mentionedUserIds)].map((uid) => ({
            message_id: data.id as string,
            mentioned_user_id: uid,
          }));
          await supabase.from("message_mentions").insert(rows);
        }
        if (data?.id && files.length) {
          await attachToMessage(data.id as string, "channel", files);
        }
      } else if (view.kind === "dm") {
        const { data, error: err } = await supabase
          .from("direct_messages")
          .insert({
            conversation_id: view.conversationId,
            author_id: user.id,
            content: body,
            ...replyPayload,
          })
          .select("id")
          .single();
        if (err) {
          setError(err.message);
          for (const f of files) URL.revokeObjectURL(f.previewUrl);
        } else {
          setReplyTo(null);
          if (unreadSinceRef.current) void clearUnreadDivider();
          if (data?.id && files.length) {
            await attachToMessage(data.id as string, "dm", files);
          }
        }
      }
    },
    [user, view, setError, clearUnreadDivider, attachToMessage]
  );

  const sendSticker = useCallback(
    async (sticker: Sticker, replyToId: string | null = null) => {
      if (!user) return;
      cacheSticker(sticker);
      const replyPayload = replyToId ? { reply_to_id: replyToId } : {};
      if (view.kind === "channel") {
        const { error: err } = await supabase.from("messages").insert({
          channel_id: view.channel.id,
          author_id: user.id,
          content: sticker.name,
          sticker_id: sticker.id,
          ...replyPayload,
        });
        if (err) setError(err.message);
        else {
          setReplyTo(null);
          if (unreadSinceRef.current) void clearUnreadDivider();
        }
      } else if (view.kind === "dm") {
        const { error: err } = await supabase.from("direct_messages").insert({
          conversation_id: view.conversationId,
          author_id: user.id,
          content: sticker.name,
          sticker_id: sticker.id,
          ...replyPayload,
        });
        if (err) setError(err.message);
        else {
          setReplyTo(null);
          if (unreadSinceRef.current) void clearUnreadDivider();
        }
      }
    },
    [user, view, setError, clearUnreadDivider]
  );

  const createPoll = useCallback(
    async (question: string, options: string[]) => {
      if (!user || view.kind !== "channel") return;
      const channelId = view.channel.id;
      const { data: msg, error: msgErr } = await supabase
        .from("messages")
        .insert({
          channel_id: channelId,
          author_id: user.id,
          content: `Enquete: ${question}`,
        })
        .select("id, channel_id, author_id, content, sticker_id, created_at")
        .single();
      if (msgErr || !msg?.id) {
        setError(msgErr?.message ?? "Não foi possível criar a enquete");
        return;
      }
      const messageId = msg.id as string;
      const rollbackMessage = async () => {
        await supabase.from("messages").delete().eq("id", messageId);
      };

      const { data: poll, error: pollErr } = await supabase
        .from("message_polls")
        .insert({ message_id: messageId, question })
        .select("id")
        .single();
      if (pollErr || !poll?.id) {
        await rollbackMessage();
        setError(pollErr?.message ?? "Não foi possível criar a enquete");
        return;
      }
      const { data: opts, error: optErr } = await supabase
        .from("message_poll_options")
        .insert(
          options.map((label, i) => ({
            poll_id: poll.id as string,
            label,
            position: i,
          }))
        )
        .select("id, label, position");
      if (optErr) {
        await supabase.from("message_polls").delete().eq("id", poll.id);
        await rollbackMessage();
        setError(optErr.message);
        return;
      }
      const agg = {
        id: poll.id as string,
        question,
        options: (opts ?? []).map((o) => ({
          id: o.id as string,
          label: o.label as string,
          position: o.position as number,
          votes: 0,
        })),
        myOptionId: null as string | null,
        totalVotes: 0,
      };
      const author = authorCache.get(user.id) ?? {
        id: user.id,
        display_name: profile?.display_name ?? "Você",
        avatar_url: profile?.avatar_url ?? null,
        username: profile?.username ?? "",
      };
      const seeded: Message = {
        ...(msg as Message),
        profiles: author,
        reactions: [],
        attachments: [],
        poll: agg,
        stickers: null,
      };
      setMessages((prev) => {
        const i = prev.findIndex((m) => m.id === messageId);
        if (i >= 0) {
          return prev.map((m) => (m.id === messageId ? { ...m, poll: agg } : m));
        }
        return [...prev, seeded];
      });
      if (unreadSinceRef.current) void clearUnreadDivider();
    },
    [user, view, setError, clearUnreadDivider, profile]
  );

  const votePoll = useCallback(
    async (pollId: string, optionId: string) => {
      if (!user) return;
      const { error: err } = await supabase
        .from("message_poll_votes")
        .upsert(
          { poll_id: pollId, option_id: optionId, user_id: user.id },
          { onConflict: "poll_id,user_id" }
        );
      if (err) {
        setError(err.message);
        return;
      }
      setMessages((prev) =>
        prev.map((m) => {
          if (m.poll?.id !== pollId) return m;
          const poll = m.poll;
          const previous = poll.myOptionId ?? null;
          if (previous === optionId) return m;
          const options = poll.options.map((o) => {
            let votes = o.votes;
            if (o.id === optionId) votes += 1;
            if (o.id === previous) votes = Math.max(0, votes - 1);
            return { ...o, votes };
          });
          return {
            ...m,
            poll: {
              ...poll,
              options,
              myOptionId: optionId,
              totalVotes: previous ? poll.totalVotes : poll.totalVotes + 1,
            },
          };
        })
      );
    },
    [user, setError]
  );

  const toggleBookmark = useCallback(
    async (message: Message, next: boolean) => {
      if (!user) return;
      const isDm = view.kind === "dm";
      const target = isDm ? { dm_message_id: message.id } : { message_id: message.id };
      if (next) {
        const { error: err } = await supabase
          .from("user_bookmarks")
          .insert({ user_id: user.id, ...target });
        if (err) {
          setError(err.message);
          return;
        }
      } else {
        const col = isDm ? "dm_message_id" : "message_id";
        const { error: err } = await supabase
          .from("user_bookmarks")
          .delete()
          .eq("user_id", user.id)
          .eq(col, message.id);
        if (err) {
          setError(err.message);
          return;
        }
      }
      setBookmarkedIds((prev) => {
        const ids = new Set(prev);
        if (next) ids.add(message.id);
        else ids.delete(message.id);
        return ids;
      });
    },
    [user, view.kind, setError]
  );

  const jumpToMessage = useCallback((messageId: string) => {
    setHighlightMessageId(messageId);
    window.setTimeout(() => setHighlightMessageId(null), 2600);
  }, []);

  const toggleChannelMute = useCallback(
    async (channelId: string) => {
      if (!user) return;
      const muted = mutedChannelIds.has(channelId);
      if (muted) {
        await supabase
          .from("channel_mutes")
          .delete()
          .eq("user_id", user.id)
          .eq("channel_id", channelId);
        setMutedChannelIds((prev) => {
          const next = new Set(prev);
          next.delete(channelId);
          return next;
        });
      } else {
        await supabase.from("channel_mutes").insert({ user_id: user.id, channel_id: channelId });
        setMutedChannelIds((prev) => new Set(prev).add(channelId));
      }
    },
    [user, mutedChannelIds]
  );

  const toggleGroupMute = useCallback(
    async (groupId: string) => {
      if (!user) return;
      const muted = mutedGroupIds.has(groupId);
      if (muted) {
        await supabase
          .from("group_mutes")
          .delete()
          .eq("user_id", user.id)
          .eq("group_id", groupId);
        setMutedGroupIds((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
      } else {
        await supabase.from("group_mutes").insert({ user_id: user.id, group_id: groupId });
        setMutedGroupIds((prev) => new Set(prev).add(groupId));
      }
    },
    [user, mutedGroupIds]
  );

  const inviteCopyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (inviteCopyTimer.current !== null) window.clearTimeout(inviteCopyTimer.current);
    },
    []
  );

  const copyInviteCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      setError("Não foi possível copiar o convite");
      return;
    }
    setError(null);
    setInviteCopied(true);
    if (inviteCopyTimer.current !== null) window.clearTimeout(inviteCopyTimer.current);
    inviteCopyTimer.current = window.setTimeout(() => setInviteCopied(false), 1800);
  }, []);

  const openChannelMessage = useCallback(
    async (channelId: string, messageId: string) => {
      let channel = channelsRef.current.find((c) => c.id === channelId) ?? null;
      if (!channel) {
        const { data } = await supabase
          .from("channels")
          .select("*")
          .eq("id", channelId)
          .maybeSingle();
        channel = (data as Channel | null) ?? null;
      }
      if (!channel) {
        setError("Canal indisponível");
        return;
      }
      setActiveGroupId(channel.group_id);
      setView({ kind: "channel", channel });
      window.setTimeout(() => jumpToMessage(messageId), 400);
    },
    [jumpToMessage, setError]
  );

  const openDmMessage = useCallback(
    (conversationId: string, messageId: string) => {
      const dm = dmRecentsRef.current.find((d) => d.conversationId === conversationId);
      if (!dm) {
        setError("Conversa indisponível");
        return;
      }
      setActiveGroupId(null);
      setView({ kind: "dm", conversationId, other: dm.other });
      window.setTimeout(() => jumpToMessage(messageId), 400);
    },
    [jumpToMessage, setError]
  );

  const messagesWithBookmarks = useMemo(() => {
    if (!bookmarkedIds.size) return messages;
    return messages.map((m) =>
      bookmarkedIds.has(m.id) ? { ...m, bookmarked: true } : m
    );
  }, [messages, bookmarkedIds]);

  const composerPlaceholder = useMemo(() => {
    if (view.kind === "dm") return `Mensagem para @${view.other.display_name}`;
    if (view.kind === "channel") return `Mensagem em #${view.channel.name}`;
    return "Mensagem";
  }, [view]);

  const activeChannelId = view.kind === "channel" ? view.channel.id : null;

  const visibleChannels = useMemo(() => {
    if (!mentionsOnly) return channels;
    return channels.filter(
      (c) =>
        c.type === "voice" ||
        c.id === activeChannelId ||
        (channelUnread.get(c.id)?.mentions ?? 0) > 0
    );
  }, [channels, mentionsOnly, channelUnread, activeChannelId]);

  const textChannels = useMemo(
    () => visibleChannels.filter((c) => c.type === "text"),
    [visibleChannels]
  );

  const announcementChannels = useMemo(
    () => visibleChannels.filter((c) => c.type === "announcement"),
    [visibleChannels]
  );

  const voiceChannels = useMemo(
    () => channels.filter((c) => c.type === "voice"),
    [channels]
  );

  const dmUnreadTotal = useMemo(() => {
    let n = 0;
    for (const v of dmUnread.values()) n += v;
    return n;
  }, [dmUnread]);

  const channelUnreadTotal = useMemo(() => {
    let n = 0;
    for (const u of channelUnread.values()) n += u.count;
    return n;
  }, [channelUnread]);

  // Window title badge + tray-friendly unread count.
  useEffect(() => {
    updateWindowBadge(dmUnreadTotal + channelUnreadTotal);
  }, [dmUnreadTotal, channelUnreadTotal]);

  // Global mute / push-to-talk while a call is live.
  // Re-register when hotkeys change in settings (custom event).
  useEffect(() => {
    if (!session || !inVoice) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    let bindQueue = Promise.resolve();
    const bind = () => {
      bindQueue = bindQueue.then(async () => {
        const wasMuted = pushToTalkPreviousMuteRef.current;
        pushToTalkPreviousMuteRef.current = null;
        if (wasMuted !== null) {
          await callClient.setAudioMuted(wasMuted).catch(() => undefined);
        }
        cleanup?.();
        cleanup = undefined;
        if (cancelled) return;
        const fn = await registerGlobalShortcuts({
          onToggleMute: () => {
            const next = !callClient.getMediaState().audioMuted;
            void callClient.setAudioMuted(next);
          },
          onPushToTalk: (active) => {
            if (active) {
              if (pushToTalkPreviousMuteRef.current !== null) return;
              const wasMuted = callClient.getMediaState().audioMuted;
              pushToTalkPreviousMuteRef.current = wasMuted;
              if (wasMuted) void callClient.setAudioMuted(false);
              return;
            }
            const wasMuted = pushToTalkPreviousMuteRef.current;
            pushToTalkPreviousMuteRef.current = null;
            if (wasMuted !== null) void callClient.setAudioMuted(wasMuted);
          },
        });
        if (cancelled) fn();
        else cleanup = fn;
      });
    };

    bind();
    const onHotkeys = () => bind();
    window.addEventListener("molezinha:hotkeys", onHotkeys);
    return () => {
      cancelled = true;
      window.removeEventListener("molezinha:hotkeys", onHotkeys);
      cleanup?.();
      const wasMuted = pushToTalkPreviousMuteRef.current;
      pushToTalkPreviousMuteRef.current = null;
      if (wasMuted !== null) void callClient.setAudioMuted(wasMuted);
    };
  }, [session, inVoice]);

  // Rich presence: detect running games/apps (Tauri only).
  useEffect(() => {
    if (!session || !user) return;
    return startActivityTracking(user.id);
  }, [session, user?.id]);

  const forwardChannelsByGroup = useMemo(() => {
    const map = new Map<string, Channel[]>();
    for (const c of forwardChannels) {
      const list = map.get(c.group_id) ?? [];
      list.push(c);
      map.set(c.group_id, list);
    }
    return map;
  }, [forwardChannels]);

  const unreadNewCount = useMemo(() => {
    if (!unreadSince) return 0;
    const t = new Date(unreadSince).getTime();
    return messages.filter((m) => new Date(m.created_at).getTime() >= t).length;
  }, [messages, unreadSince]);

  const unreadSinceLabel = useMemo(() => {
    if (!unreadSince) return "";
    return new Date(unreadSince).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [unreadSince]);

  const isStaff = myRole === "owner" || myRole === "admin";

  function canModerateMember(targetRole?: string) {
    if (myRole === "owner") return targetRole !== "owner";
    if (myRole === "admin") return targetRole === "member";
    return false;
  }

  async function moderateMemberFromPopout(userId: string, ban: boolean, reason: string) {
    if (!activeGroupId) return;
    const { error } = await supabase.rpc("remove_group_member", {
      p_group_id: activeGroupId,
      p_user_id: userId,
      p_ban: ban,
      p_reason: reason || null,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== userId));
    setMemberPopoutId(null);
  }

  const toggleReaction = useCallback(
    async (message: Message, emoji: string) => {
      if (!user) return;
      const isDm = view.kind === "dm";
      const table = isDm ? "dm_message_reactions" : "message_reactions";
      const mine = message.reactions?.find((r) => r.emoji === emoji && r.me);
      if (mine) {
        const { error: err } = await supabase
          .from(table)
          .delete()
          .eq("message_id", message.id)
          .eq("user_id", user.id)
          .eq("emoji", emoji);
        if (err) setError(err.message);
        else {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== message.id) return m;
              const next = (m.reactions ?? [])
                .map((r) =>
                  r.emoji === emoji
                    ? { ...r, count: Math.max(0, r.count - 1), me: false }
                    : r
                )
                .filter((r) => r.count > 0);
              return { ...m, reactions: next };
            })
          );
        }
      } else {
        const { error: err } = await supabase.from(table).insert({
          message_id: message.id,
          user_id: user.id,
          emoji,
        });
        if (err) setError(err.message);
        else {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== message.id) return m;
              const existing = (m.reactions ?? []).find((r) => r.emoji === emoji);
              const next = existing
                ? (m.reactions ?? []).map((r) =>
                    r.emoji === emoji
                      ? { ...r, count: r.count + (r.me ? 0 : 1), me: true }
                      : r
                  )
                : [...(m.reactions ?? []), { emoji, count: 1, me: true }];
              return { ...m, reactions: next };
            })
          );
        }
      }
    },
    [user, view.kind, setError]
  );

  const handleContextAction = useCallback(
    async (message: Message, action: ContextMenuAction) => {
      if (!user) return;
      switch (action.type) {
        case "react":
          await toggleReaction(message, action.emoji);
          break;
        case "reply":
          setReplyTo(message);
          break;
        case "forward": {
          setForwardSource(message);
          if (groups.length) {
            const { data } = await supabase
              .from("channels")
              .select("*")
              .eq("type", "text")
              .in(
                "group_id",
                groups.map((g) => g.id)
              );
            setForwardChannels((data as Channel[]) ?? []);
          } else {
            setForwardChannels([]);
          }
          break;
        }
        case "copyText":
          if (message.content) {
            void navigator.clipboard.writeText(message.content);
          }
          break;
        case "copyId":
          void navigator.clipboard.writeText(message.id);
          break;
        case "pin":
        case "unpin": {
          if (view.kind !== "channel") return;
          if (action.type === "pin") {
            const { error: err } = await supabase.from("channel_pins").insert({
              channel_id: view.channel.id,
              message_id: message.id,
              pinned_by: user.id,
            });
            if (err) setError(err.message);
            else {
              setMessages((prev) =>
                prev.map((m) => (m.id === message.id ? { ...m, pinned: true } : m))
              );
            }
          } else {
            const { error: err } = await supabase
              .from("channel_pins")
              .delete()
              .eq("message_id", message.id);
            if (err) setError(err.message);
            else {
              setMessages((prev) =>
                prev.map((m) => (m.id === message.id ? { ...m, pinned: false } : m))
              );
            }
          }
          break;
        }
        case "bookmark":
          await toggleBookmark(message, true);
          break;
        case "unbookmark":
          await toggleBookmark(message, false);
          break;
        case "markUnread": {
          if (view.kind === "channel") {
            const { error: err } = await supabase.rpc("mark_channel_unread", {
              p_channel_id: view.channel.id,
              p_message_created_at: message.created_at,
            });
            if (err) setError(err.message);
            else {
              setUnreadSince(message.created_at);
              void loadUnread();
            }
          } else if (view.kind === "dm") {
            const { error: err } = await supabase.rpc("mark_dm_unread", {
              p_conversation_id: view.conversationId,
              p_message_created_at: message.created_at,
            });
            if (err) setError(err.message);
            else {
              setUnreadSince(message.created_at);
              void loadUnread();
            }
          }
          break;
        }
        case "delete": {
          const table = view.kind === "dm" ? "direct_messages" : "messages";
          const { error: err } = await supabase.from(table).delete().eq("id", message.id);
          if (err) setError(err.message);
          else {
            setMessages((prev) => prev.filter((m) => m.id !== message.id));
            setReplyTo((r) => (r?.id === message.id ? null : r));
          }
          break;
        }
        default:
          break;
      }
    },
    [user, view, groups, toggleReaction, toggleBookmark, loadUnread, setError]
  );

  const handleForward = useCallback(
    async (dest: ForwardDestination) => {
      if (!user || !forwardSource) return;
      const src = forwardSource;
      setForwardSource(null);
      const meta: ForwardedFrom = {
        author_id: src.author_id,
        author_display_name: src.profiles?.display_name ?? "Alguém",
        content: src.content,
        sticker_id: src.sticker_id,
        source: view.kind === "dm" ? "dm" : "channel",
      };
      if (dest.kind === "channel") {
        const { error: err } = await supabase.from("messages").insert({
          channel_id: dest.channel.id,
          author_id: user.id,
          content: src.content || src.stickers?.name || "mensagem",
          sticker_id: src.sticker_id,
          forwarded_from: meta,
        });
        if (err) setError(err.message);
      } else {
        const { error: err } = await supabase.from("direct_messages").insert({
          conversation_id: dest.conversationId,
          author_id: user.id,
          content: src.content || src.stickers?.name || "mensagem",
          sticker_id: src.sticker_id,
          forwarded_from: meta,
        });
        if (err) setError(err.message);
        else void loadDmRecents();
      }
    },
    [user, forwardSource, view.kind, setError, loadDmRecents]
  );

  async function createGroup(name: string) {
    setError(null);
    const { data, error: err } = await supabase.rpc("create_group_with_defaults", {
      group_name: name,
    });
    if (err) {
      setError(err.message);
      return;
    }
    await loadGroups();
    if (data?.id) selectGroup(data.id);
  }

  async function handleJoined(groupId: string) {
    setError(null);
    await loadGroups();
    if (groupId) selectGroup(groupId);
  }

  async function openDm(other: Profile) {
    const { data, error: err } = await supabase.rpc("get_or_create_dm", {
      other_user_id: other.id,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setView({ kind: "dm", conversationId: data as string, other });
    setActiveGroupId(null);
    void loadDmRecents();
  }

  async function addFriendById(username: string) {
    setError(null);
    const { error: err } = await supabase.rpc("send_friend_request", {
      p_username: username,
    });
    if (err) {
      setError(err.message);
      return;
    }
    void loadFriends();
    void loadFriendRequests();
  }

  async function respondFriendRequest(friendshipId: string, accept: boolean) {
    setError(null);
    const request = friendRequests.find((r) => r.id === friendshipId);
    const { error: err } = await supabase.rpc("respond_friend_request", {
      p_friendship_id: friendshipId,
      p_accept: accept,
    });
    if (err) {
      setError(err.message);
      void loadFriendRequests();
      return;
    }
    setFriendRequests((prev) => prev.filter((r) => r.id !== friendshipId));
    void loadFriends();
    // Create/open the DM so the new friend appears in the list and can be messaged.
    if (accept && request) {
      await openDm(request.requester);
      return;
    }
    void loadDmRecents();
  }

  async function joinVoice(channel: Channel) {
    if (!session?.access_token || joiningVoice) return;
    if (inVoice && voiceChannel?.id === channel.id) {
      setView({ kind: "channel", channel });
      return;
    }
    setJoiningVoice(true);
    setError(null);
    try {
      // Unlock WebView2 autoplay while we still have the click gesture.
      // A fresh AudioContext later (RNNoise) may still start suspended — CallClient
      // falls back to the raw mic / resumes on the next click inside the call UI.
      try {
        unlockCallSounds();
        const ctx = new AudioContext();
        await ctx.resume();
        const silent = new Audio(
          "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="
        );
        silent.volume = 0.01;
        await silent.play().catch(() => undefined);
        void ctx.close().catch(() => undefined);
      } catch {
        /* ignore */
      }

      await callClient.join(channel.id, session.access_token, {
        audio: true,
        video: false,
        muteOnJoin: profile?.mute_on_join ?? false,
        userId: session.user.id,
      });
      setVoiceChannel(channel);
      setInVoice(true);
      setView({ kind: "channel", channel });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na call");
    } finally {
      setJoiningVoice(false);
    }
  }

  if (loading) {
    return (
      <div className="app-root">
        <TitleBar />
        <div className="app-root-body splash">
          <div className="splash-inner">
            <span className="brand-pulse">molezinha</span>
            <div className="splash-bar" aria-hidden />
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-root">
        <TitleBar />
        <div className="app-root-body">
          <AuthPage />
        </div>
      </div>
    );
  }

  const showChat =
    (view.kind === "channel" && isChatChannel(view.channel)) || view.kind === "dm";
  const isAnnouncement = view.kind === "channel" && view.channel.type === "announcement";
  const composerLocked = isAnnouncement && !isStaff;
  const canSearchHere = showChat;
  // The server accent lives on the shell so rail, sidebar and header can all tint from it.
  const shellStyle = activeGroup?.accent_color
    ? ({ ["--group-accent" as string]: activeGroup.accent_color } as CSSProperties)
    : undefined;
  const mainStyle = activeGroup?.wallpaper_url
    ? ({ backgroundImage: `url(${activeGroup.wallpaper_url})` } as CSSProperties)
    : undefined;
  const viewKey =
    view.kind === "channel"
      ? `channel:${view.channel.id}`
      : view.kind === "dm"
        ? `dm:${view.conversationId}`
        : "home";
  const inActiveVoiceView =
    inVoice &&
    !!voiceChannel &&
    view.kind === "channel" &&
    view.channel.type === "voice" &&
    view.channel.id === voiceChannel.id;

  return (
    <>
      <div className="app-root">
        <TitleBar />
        <div className="app-root-body">
      <div className={`app-shell ${activeGroup ? "" : "no-members"}`} style={shellStyle}>
        <NotificationToasts toasts={toasts} onDismiss={dismissToast} />
        <aside className="rail">
          <NeoTooltip label="Mensagens diretas">
            <button
              type="button"
              className={`group-pill home ${view.kind === "home" || view.kind === "dm" ? "active" : ""}`}
              onClick={goHome}
            >
              M
              {dmUnreadTotal > 0 && (
                <span className="rail-badge mention">{formatBadgeCount(dmUnreadTotal)}</span>
              )}
            </button>
          </NeoTooltip>
          <div className="rail-divider" />
          {groups.map((g) => {
            let hasUnread = false;
            let hasMention = false;
            for (const u of channelUnread.values()) {
              if (u.groupId !== g.id) continue;
              if (u.count > 0) hasUnread = true;
              if (u.mentions > 0) hasMention = true;
            }
            return (
              <NeoTooltip key={g.id} label={g.name}>
                <button
                  type="button"
                  className={`group-pill ${activeGroupId === g.id ? "active" : ""} ${hasUnread || hasMention ? "has-unread" : ""}`}
                  style={
                    g.accent_color
                      ? ({ ["--pill-accent" as string]: g.accent_color } as CSSProperties)
                      : undefined
                  }
                  onClick={() => selectGroup(g.id)}
                >
                  {g.icon_url ? (
                    <img className="group-pill-icon" src={g.icon_url} alt="" />
                  ) : (
                    g.name.slice(0, 2).toUpperCase()
                  )}
                  {hasMention ? (
                    <span className="rail-badge mention">@</span>
                  ) : hasUnread ? (
                    <span className="rail-badge" />
                  ) : null}
                </button>
              </NeoTooltip>
            );
          })}
          <NeoTooltip label="Criar grupo">
            <button type="button" className="group-pill" onClick={() => setPromptKind("create")}>
              <IconPlus />
            </button>
          </NeoTooltip>
          <NeoTooltip label="Entrar com convite">
            <button type="button" className="group-pill" onClick={() => setInviteOpen(true)}>
              <IconJoin />
            </button>
          </NeoTooltip>
        </aside>

        <aside className="sidebar">
          <div className="group-head">
            <div className="group-head-top">
              <h3 className="group-head-title" title={activeGroup?.name ?? "Mensagens"}>
                {activeGroup ? activeGroup.name : "Mensagens"}
              </h3>
              {activeGroup && (
                <div className="group-head-actions">
                  <NeoTooltip
                    label={
                      mutedGroupIds.has(activeGroup.id)
                        ? "Reativar notificações do grupo"
                        : "Silenciar grupo"
                    }
                    side="bottom"
                  >
                    <button
                      type="button"
                      className={`head-action ${mutedGroupIds.has(activeGroup.id) ? "active" : ""}`}
                      aria-label="Silenciar grupo"
                      aria-pressed={mutedGroupIds.has(activeGroup.id)}
                      onClick={() => void toggleGroupMute(activeGroup.id)}
                    >
                      {mutedGroupIds.has(activeGroup.id) ? <IconBellOff /> : <IconBell />}
                    </button>
                  </NeoTooltip>
                  {isStaff && (
                    <NeoTooltip label="Configurações do grupo" side="bottom">
                      <button
                        type="button"
                        className="head-action"
                        aria-label="Configurações do grupo"
                        onClick={() => setGroupSettingsOpen(true)}
                      >
                        <IconSettings />
                      </button>
                    </NeoTooltip>
                  )}
                </div>
              )}
            </div>
            {activeGroup && (
              <button
                type="button"
                className={`invite-copy ${inviteCopied ? "copied" : ""}`}
                onClick={() => void copyInviteCode(activeGroup.invite_code)}
              >
                <span className="invite-copy-label">
                  {inviteCopied ? "copiado" : "convite"}
                </span>
                <code className="invite-copy-code">{activeGroup.invite_code}</code>
                <span className="invite-copy-action" aria-hidden>
                  {inviteCopied ? <IconCheck /> : <IconCopy />}
                </span>
              </button>
            )}
          </div>

          <div className="sidebar-scroll">
            {activeGroup ? (
              <>
                <div className="section-label-row">
                  <span className="section-label">
                    {mentionsOnly ? "Canais com menção" : "Canais de texto"}
                  </span>
                  <NeoTooltip
                    label={mentionsOnly ? "Mostrar todos os canais" : "Mostrar só com menções"}
                    side="bottom"
                  >
                    <button
                      type="button"
                      className={`section-filter ${mentionsOnly ? "active" : ""}`}
                      aria-label="Filtrar por menções"
                      aria-pressed={mentionsOnly}
                      onClick={() => setMentionsOnly((v) => !v)}
                    >
                      <IconAt />
                    </button>
                  </NeoTooltip>
                </div>
                {textChannels.length === 0 && (
                  <p className="muted empty-copy">
                    {mentionsOnly ? "Nenhuma menção pendente." : "Nenhum canal de texto."}
                  </p>
                )}
                {textChannels.map((c) => {
                  const unread = channelUnread.get(c.id);
                  const mentionN = unread?.mentions ?? 0;
                  const unreadN = unread?.count ?? 0;
                  const isActive = view.kind === "channel" && view.channel.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title="Clique direito para silenciar"
                      className={`channel-item ${isActive ? "active" : ""} ${unreadN > 0 || mentionN > 0 ? "unread" : ""} ${mutedChannelIds.has(c.id) ? "muted-channel" : ""}`}
                      onClick={() => setView({ kind: "channel", channel: c })}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        void toggleChannelMute(c.id);
                      }}
                    >
                      {isActive && <NavMarker />}
                      <IconHash />
                      <span className="channel-item-name">{c.name}</span>
                      {mutedChannelIds.has(c.id) ? (
                        <span className="channel-mute-flag" title="Silenciado">
                          <IconBell />
                        </span>
                      ) : mentionN > 0 ? (
                        <span className="unread-badge mention">{formatBadgeCount(mentionN)}</span>
                      ) : unreadN > 0 ? (
                        <span className="unread-badge">{formatBadgeCount(unreadN)}</span>
                      ) : null}
                    </button>
                  );
                })}

                {announcementChannels.length > 0 && (
                  <>
                    <div className="section-label">Avisos</div>
                    {announcementChannels.map((c) => {
                      const unread = channelUnread.get(c.id);
                      const mentionN = unread?.mentions ?? 0;
                      const unreadN = unread?.count ?? 0;
                      const isActive = view.kind === "channel" && view.channel.id === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          title="Clique direito para silenciar"
                          className={`channel-item ${isActive ? "active" : ""} ${unreadN > 0 || mentionN > 0 ? "unread" : ""} ${mutedChannelIds.has(c.id) ? "muted-channel" : ""}`}
                          onClick={() => setView({ kind: "channel", channel: c })}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            void toggleChannelMute(c.id);
                          }}
                        >
                          {isActive && <NavMarker />}
                          <IconMegaphone />
                          <span className="channel-item-name">{c.name}</span>
                          {mutedChannelIds.has(c.id) ? (
                            <span className="channel-mute-flag" title="Silenciado">
                              <IconBell />
                            </span>
                          ) : mentionN > 0 ? (
                            <span className="unread-badge mention">{formatBadgeCount(mentionN)}</span>
                          ) : unreadN > 0 ? (
                            <span className="unread-badge">{formatBadgeCount(unreadN)}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </>
                )}

                <div className="section-label">Canais de voz</div>
                {voiceChannels.map((c) => {
                    const inChannel = members.filter((m) => m.voice_channel_id === c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={`channel-item ${voiceChannel?.id === c.id && inVoice ? "active" : ""}`}
                        onClick={() => void joinVoice(c)}
                      >
                        <IconSpeaker />
                        <span className="channel-item-voice">
                          {c.name}
                          {inChannel.length > 0 && (
                            <span className="muted channel-item-voice-peers">
                              {inChannel.map((m) => m.display_name).join(", ")}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="channel-item"
                  onClick={() => setPromptKind("addFriend")}
                >
                  <IconFriends />
                  Adicionar amigo
                </button>
                {friendRequests.length > 0 && (
                  <button
                    type="button"
                    className={`channel-item ${view.kind === "home" ? "active" : ""}`}
                    onClick={goHome}
                  >
                    <IconFriends />
                    <span className="channel-item-name">Pedidos de amizade</span>
                    <span className="unread-badge mention">
                      {formatBadgeCount(friendRequests.length)}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className={`channel-item ${bookmarksOpen ? "active" : ""}`}
                  onClick={() => setBookmarksOpen((v) => !v)}
                >
                  <IconBookmark />
                  Salvos
                </button>
                <div className="section-label">Mensagens diretas</div>
                {dmRecents.length === 0 && (
                  <p className="muted empty-copy">
                    Aceite um amigo ou adicione alguém pelo @username para começar a conversar.
                  </p>
                )}
                {dmRecents.map((dm) => {
                  const n = dmUnread.get(dm.conversationId) ?? 0;
                  const isActive =
                    view.kind === "dm" && view.conversationId === dm.conversationId;
                  return (
                  <button
                    key={dm.conversationId}
                    type="button"
                    className={`channel-item ${isActive ? "active" : ""} ${n > 0 ? "unread" : ""}`}
                    onClick={() => {
                      setActiveGroupId(null);
                      setView({
                        kind: "dm",
                        conversationId: dm.conversationId,
                        other: dm.other,
                      });
                    }}
                  >
                    {isActive && <NavMarker />}
                    <Avatar
                      size="xs"
                      name={dm.other.display_name}
                      url={dm.other.avatar_url}
                      id={dm.other.id}
                      status={dm.other.status}
                    />
                    <span className="channel-item-name">{dm.other.display_name}</span>
                    {n > 0 && <span className="unread-badge">{formatBadgeCount(n)}</span>}
                  </button>
                  );
                })}
              </>
            )}
          </div>

          <div className="user-panel" ref={userPanelRef}>
            <UserPopout
              open={userPopoutOpen}
              profile={profile}
              anchorRef={userPanelRef}
              onClose={() => setUserPopoutOpen(false)}
              onEditProfile={() => {
                setUserPopoutOpen(false);
                setSettingsSection("profile");
                setSettingsOpen(true);
              }}
            />
            <button
              type="button"
              className="user-panel-main"
              aria-label="Abrir seu perfil"
              aria-expanded={userPopoutOpen}
              onClick={() => {
                setMemberPopoutId(null);
                memberAnchorRef.current = null;
                setUserPopoutOpen((v) => !v);
              }}
            >
              <Avatar
                size="sm"
                name={profile?.display_name ?? "?"}
                url={profile?.avatar_url}
                id={profile?.id}
                status={profile?.status}
              />
              <div className="user-panel-identity">
                <span className="user-panel-name">{profile?.display_name}</span>
                <span className="user-panel-handle muted">@{profile?.username}</span>
              </div>
            </button>
            <NeoTooltip label="Configurações" side="top">
              <button
                className="neo-btn neo-btn-icon"
                type="button"
                aria-label="Configurações"
                onClick={() => {
                  setUserPopoutOpen(false);
                  setSettingsSection("account");
                  setSettingsOpen(true);
                }}
              >
                <IconSettings />
              </button>
            </NeoTooltip>
          </div>
        </aside>

        <main
          className={`main ${activeGroup?.wallpaper_url ? "main-wallpaper" : ""}`}
          style={mainStyle}
        >
          <header className="main-header">
            {view.kind === "channel" && view.channel.type === "text" && <IconHash />}
            {view.kind === "channel" && view.channel.type === "voice" && <IconSpeaker />}
            {isAnnouncement && <IconMegaphone />}
            <h2>
              {view.kind === "channel" && view.channel.name}
              {view.kind === "dm" && view.other.display_name}
              {view.kind === "home" && "Mensagens"}
            </h2>
            <div className="main-header-actions">
              {view.kind === "channel" && isChatChannel(view.channel) && (
                <NeoTooltip label="Mensagens fixadas" side="bottom">
                  <button
                    type="button"
                    className={`neo-btn neo-btn-icon ${pinsOpen ? "active" : ""}`}
                    aria-label="Mensagens fixadas"
                    aria-pressed={pinsOpen}
                    onClick={() => setPinsOpen((v) => !v)}
                  >
                    <IconPin />
                  </button>
                </NeoTooltip>
              )}
              {canSearchHere && (
                <NeoTooltip label="Buscar (Ctrl+K)" side="bottom">
                  <button
                    type="button"
                    className="neo-btn neo-btn-icon"
                    aria-label="Buscar mensagens"
                    onClick={() => setSearchOpen(true)}
                  >
                    <IconSearch />
                  </button>
                </NeoTooltip>
              )}
            </div>
          </header>

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="error-banner-dismiss"
                aria-label="Fechar"
                onClick={() => setError(null)}
              >
                ×
              </button>
            </div>
          )}

          {inVoice && voiceChannel && (
            <div className={inActiveVoiceView ? "call-stage" : "call-stage call-stage-compact"}>
              <CallBar
                channelId={voiceChannel.id}
                channelName={voiceChannel.name}
                userId={user?.id ?? ""}
                isStaff={isStaff}
                onLeave={() => {
                  void callClient.leave();
                  setInVoice(false);
                  setVoiceChannel(null);
                }}
              />
            </div>
          )}

          <motion.div
            key={viewKey}
            className={`view-shell ${inActiveVoiceView ? "view-shell-collapsed" : ""}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
          {showChat ? (
            <>
              {unreadSince && unreadNewCount > 0 && (
                <div className="unread-jump-bar">
                  <span>
                    {unreadNewCount === 1
                      ? `1 mensagem nova desde ${unreadSinceLabel}`
                      : `${unreadNewCount} mensagens novas desde ${unreadSinceLabel}`}
                  </span>
                  <button
                    type="button"
                    className="unread-jump-mark-read"
                    onClick={() => void clearUnreadDivider()}
                  >
                    Marcar como lida
                  </button>
                </div>
              )}
              <div className="chat-surface">
                {messagesLoading && messagesWithBookmarks.length === 0 ? (
                  <div className="messages">
                    <SkeletonList rows={5} />
                  </div>
                ) : (
                <MessageList
                  messages={messagesWithBookmarks}
                  unreadSince={unreadSince}
                  myUsername={profile?.username}
                  myUserId={user?.id}
                  canModerate={view.kind === "channel" && isStaff}
                  canPin={view.kind === "channel" && isStaff}
                  savedStickerIds={savedStickerIds}
                  highlightMessageId={highlightMessageId}
                  typingUsers={typingNames}
                  emptyTitle={
                    isAnnouncement
                      ? "Nenhum aviso publicado"
                      : view.kind === "dm"
                        ? `Comece a conversa com ${view.other.display_name}`
                        : "Nada por aqui ainda"
                  }
                  emptyHint={
                    isAnnouncement
                      ? "Só a staff publica neste canal."
                      : "Manda a primeira mensagem — anexos, figurinhas e enquetes também rolam."
                  }
                  emptyArt={view.kind === "dm" ? "dms" : "messages"}
                  onSaveSticker={saveSticker}
                  onContextAction={(msg, action) => void handleContextAction(msg, action)}
                  onToggleReaction={(msg, emoji) => void toggleReaction(msg, emoji)}
                  onVotePoll={
                    view.kind === "channel"
                      ? (pollId, optionId) => void votePoll(pollId, optionId)
                      : undefined
                  }
                  onPlayYoutube={
                    view.kind === "channel" &&
                    inVoice &&
                    voiceChannel?.id === view.channel.id
                      ? (url) => {
                          void musicApi.play(view.channel.id, url).catch((err) => {
                            setError(
                              err instanceof Error ? err.message : "Não foi possível tocar na call"
                            );
                          });
                        }
                      : undefined
                  }
                />
                )}
                {view.kind === "channel" && (
                  <PinsPanel
                    open={pinsOpen}
                    channelId={view.channel.id}
                    onClose={() => setPinsOpen(false)}
                    onJump={jumpToMessage}
                  />
                )}
              </div>
              <ChatComposer
                key={
                  view.kind === "dm"
                    ? view.conversationId
                    : view.kind === "channel"
                      ? view.channel.id
                      : "chat"
                }
                placeholder={composerPlaceholder}
                replyTo={replyTo}
                disabled={composerLocked}
                disabledHint={
                  composerLocked ? "Só a staff pode publicar em canais de avisos." : undefined
                }
                onCancelReply={() => setReplyTo(null)}
                mentionCandidates={
                  view.kind === "channel"
                    ? members.map((m) => ({
                        id: m.id,
                        username: m.username,
                        display_name: m.display_name,
                        avatar_url: m.avatar_url,
                      }))
                    : undefined
                }
                onSend={(content, mentionedUserIds, replyToId, attachments) =>
                  void sendMessage(content, mentionedUserIds, replyToId ?? null, attachments)
                }
                onSendSticker={(s, replyToId) => void sendSticker(s, replyToId ?? null)}
                onTyping={emitTyping}
                onCreatePoll={
                  view.kind === "channel" && !composerLocked
                    ? () => setPollOpen(true)
                    : undefined
                }
                onError={setError}
              />
            </>
          ) : view.kind === "home" ? (
            <div className="home-feed">
              <div className="home-feed-title">
                <h2>Amigos e mensagens</h2>
                <p className="muted">
                  Aceite pedidos, abra uma conversa com um amigo ou adicione alguém pelo @username.
                </p>
              </div>
              {friendRequests.length > 0 && (
                <section className="home-requests">
                  <div className="section-label">
                    Pedidos de amizade — {friendRequests.length}
                  </div>
                  {friendRequests.map((req) => (
                    <div key={req.id} className="home-request-row">
                      <Avatar
                        size="md"
                        name={req.requester.display_name}
                        url={req.requester.avatar_url}
                        id={req.requester.id}
                        status={req.requester.status}
                      />
                      <div className="user-panel-identity">
                        <span className="user-panel-name">{req.requester.display_name}</span>
                        <span className="user-panel-handle muted">
                          @{req.requester.username}
                        </span>
                      </div>
                      <div className="stack-row home-request-actions">
                        <button
                          type="button"
                          className="neo-btn neo-btn-primary neo-btn-compact"
                          onClick={() => void respondFriendRequest(req.id, true)}
                        >
                          Aceitar
                        </button>
                        <button
                          type="button"
                          className="neo-btn neo-btn-danger neo-btn-compact"
                          onClick={() => void respondFriendRequest(req.id, false)}
                        >
                          Recusar
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}
              <section className="home-friends">
                <div className="section-label">Amigos — {friends.length}</div>
                {friends.length === 0 ? (
                  <EmptyState
                    art="friends"
                    title="Nenhum amigo ainda"
                    hint="Adicione alguém pelo @username para conversar no privado."
                  />
                ) : (
                  <div className="home-dm-list">
                    {friends.map((friend) => {
                      const existing = dmRecents.find((d) => d.other.id === friend.id);
                      const n = existing
                        ? dmUnread.get(existing.conversationId) ?? 0
                        : 0;
                      return (
                        <div key={friend.id} className="home-request-row">
                          <Avatar
                            size="md"
                            name={friend.display_name}
                            url={friend.avatar_url}
                            id={friend.id}
                            status={friend.status}
                          />
                          <div className="user-panel-identity">
                            <span className="user-panel-name">{friend.display_name}</span>
                            <span className="user-panel-handle muted">
                              @{friend.username}
                            </span>
                          </div>
                          <div className="stack-row home-request-actions">
                            {n > 0 && (
                              <span className="unread-badge">{formatBadgeCount(n)}</span>
                            )}
                            <button
                              type="button"
                              className="neo-btn neo-btn-primary neo-btn-compact"
                              onClick={() => void openDm(friend)}
                            >
                              Mensagem
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              {dmRecents.length > 0 && (
                <section className="home-dm-section">
                  <div className="section-label">Conversas recentes</div>
                  <div className="home-dm-list">
                    {dmRecents.map((dm) => {
                      const n = dmUnread.get(dm.conversationId) ?? 0;
                      return (
                        <button
                          key={dm.conversationId}
                          type="button"
                          className="home-dm-row"
                          onClick={() => {
                            setActiveGroupId(null);
                            setView({
                              kind: "dm",
                              conversationId: dm.conversationId,
                              other: dm.other,
                            });
                          }}
                        >
                          <Avatar
                            size="lg"
                            name={dm.other.display_name}
                            url={dm.other.avatar_url}
                            id={dm.other.id}
                            status={dm.other.status}
                          />
                          <div className="user-panel-identity">
                            <span className="user-panel-name">{dm.other.display_name}</span>
                            <span className="user-panel-handle muted">
                              @{dm.other.username}
                            </span>
                          </div>
                          {n > 0 && (
                            <span className="unread-badge">{formatBadgeCount(n)}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          ) : inActiveVoiceView ? null : (
            <EmptyState
              art="voice"
              title="Canal de voz"
              hint={
                joiningVoice
                  ? "Entrando na call…"
                  : "Entre pelo canal na barra à esquerda para conectar áudio e vídeo."
              }
            />
          )}
          </motion.div>
        </main>

        {activeGroup && (
          <aside className="members-panel">
            <div className="section-label section-label-tight">
              Membros{members.length > 0 ? ` — ${members.length}` : ""}
            </div>
            <div className="sidebar-scroll">
              {members.length === 0 && <SkeletonList rows={4} />}
              {members.map((m) => {
                const isFriend = friendIds.has(m.id);
                const isSelf = m.id === user?.id;
                const isOpen = memberPopoutId === m.id;
                return (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    className={`member-row ${isOpen ? "active" : ""}`}
                    aria-expanded={isOpen}
                    aria-label={`Perfil de ${m.display_name}`}
                    ref={(el) => {
                      if (el) memberRowRefs.current.set(m.id, el);
                      else memberRowRefs.current.delete(m.id);
                    }}
                    onClick={(e) => {
                      if (memberPopoutId === m.id) {
                        setMemberPopoutId(null);
                        memberAnchorRef.current = null;
                        return;
                      }
                      setUserPopoutOpen(false);
                      memberAnchorRef.current = e.currentTarget;
                      setMemberPopoutId(m.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).click();
                      }
                    }}
                  >
                    <Avatar
                      size="sm"
                      name={m.display_name ?? "?"}
                      url={m.avatar_url}
                      id={m.id}
                      status={m.status}
                    />
                    <span className="member-row-body">
                      <span className="member-row-name">{m.display_name}</span>
                      {(m.activity?.name || m.custom_status) && (
                        <span className="muted member-activity-line">
                          {m.activity?.name || m.custom_status}
                        </span>
                      )}
                      {m.role && m.role !== "member" && (
                        <span className={`role-badge ${m.role}`}>{m.role}</span>
                      )}
                    </span>
                    {!isSelf && isFriend && (
                      <button
                        type="button"
                        className="neo-btn neo-btn-tiny"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openDm(m);
                        }}
                      >
                        DM
                      </button>
                    )}
                    {!isSelf && !isFriend && (
                      <button
                        type="button"
                        className="neo-btn neo-btn-primary neo-btn-tiny"
                        onClick={(e) => {
                          e.stopPropagation();
                          void addFriendById(m.username);
                        }}
                      >
                        +
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <ProfilePopout
              open={Boolean(memberPopoutId && popMember)}
              profile={popMember}
              anchorRef={memberAnchorRef}
              placement="left"
              label={popMember ? `Perfil de ${popMember.display_name}` : "Perfil"}
              onClose={() => {
                setMemberPopoutId(null);
                memberAnchorRef.current = null;
              }}
              footer={
                popMember && popMember.id === user?.id ? (
                  <button
                    type="button"
                    className="neo-btn neo-btn-primary neo-btn-block popout-cta"
                    onClick={() => {
                      setMemberPopoutId(null);
                      setSettingsSection("profile");
                      setSettingsOpen(true);
                    }}
                  >
                    Editar perfil
                  </button>
                ) : popMember ? (
                  <div className="popout-extras">
                    {mutualGroups.length > 0 && (
                      <div className="popout-mutuals">
                        <span className="section-label section-label-inline">
                          Grupos em comum
                        </span>
                        <div className="popout-mutual-list">
                          {mutualGroups.map((g) => (
                            <button
                              key={g.id}
                              type="button"
                              className="popout-mutual-chip"
                              onClick={() => {
                                setMemberPopoutId(null);
                                selectGroup(g.id);
                              }}
                            >
                              {g.icon_url ? <img src={g.icon_url} alt="" /> : null}
                              <span>{g.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <label className="popout-note">
                      <span className="section-label section-label-inline">
                        Nota (só você vê)
                      </span>
                      <textarea
                        className="neo-input"
                        rows={2}
                        value={memberNote}
                        placeholder="ex: conheci na call de sexta"
                        onChange={(e) => saveMemberNote(popMember.id, e.target.value)}
                      />
                    </label>
                    {friendIds.has(popMember.id) ? (
                      <div className="stack-row popout-actions">
                        <button
                          type="button"
                          className="neo-btn neo-btn-primary neo-btn-grow"
                          onClick={() => {
                            const target = popMember;
                            setMemberPopoutId(null);
                            void openDm(target);
                          }}
                        >
                          Mensagem
                        </button>
                        <button
                          type="button"
                          className="neo-btn neo-btn-grow"
                          disabled={!callTargetFor(popMember)}
                          onClick={() => {
                            const target = callTargetFor(popMember);
                            setMemberPopoutId(null);
                            if (target) void joinVoice(target);
                          }}
                        >
                          Chamar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="neo-btn neo-btn-primary neo-btn-block popout-actions"
                        onClick={() => {
                          const username = popMember.username;
                          setMemberPopoutId(null);
                          void addFriendById(username);
                        }}
                      >
                        Adicionar amigo
                      </button>
                    )}
                    {isStaff && canModerateMember(popMember.role) && (
                      <div className="stack-row popout-actions">
                        <button
                          type="button"
                          className="neo-btn neo-btn-grow"
                          onClick={() => {
                            setMemberPopoutId(null);
                            setMemberModeration({
                              userId: popMember.id,
                              name: popMember.display_name,
                              ban: false,
                            });
                          }}
                        >
                          Expulsar
                        </button>
                        <button
                          type="button"
                          className="neo-btn neo-btn-danger neo-btn-grow"
                          onClick={() => {
                            setMemberPopoutId(null);
                            setMemberModeration({
                              userId: popMember.id,
                              name: popMember.display_name,
                              ban: true,
                            });
                          }}
                        >
                          Banir
                        </button>
                      </div>
                    )}
                  </div>
                ) : null
              }
            />
          </aside>
        )}
      </div>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        initialSection={settingsSection}
        onClose={() => setSettingsOpen(false)}
      />
      {activeGroup && (
        <GroupSettingsModal
          open={groupSettingsOpen}
          groupId={activeGroup.id}
          groupName={activeGroup.name}
          inviteCode={activeGroup.invite_code}
          myRole={myRole}
          channels={channels}
          iconUrl={activeGroup.icon_url}
          wallpaperUrl={activeGroup.wallpaper_url ?? null}
          accentColor={activeGroup.accent_color ?? "#1f6f5b"}
          inviteMaxUses={activeGroup.invite_max_uses ?? null}
          onClose={() => setGroupSettingsOpen(false)}
          onChannelsChanged={() => void reloadChannels()}
          onInviteChanged={(code) => {
            setGroups((prev) =>
              prev.map((g) => (g.id === activeGroup.id ? { ...g, invite_code: code } : g))
            );
          }}
          onBrandingChanged={(patch) => {
            setGroups((prev) =>
              prev.map((g) => (g.id === activeGroup.id ? { ...g, ...patch } : g))
            );
          }}
          onGroupDeleted={() => {
            setGroupSettingsOpen(false);
            setActiveGroupId(null);
            setChannels([]);
            setMembers([]);
            setView({ kind: "home" });
            if (inVoice) {
              void callClient.leave();
              setInVoice(false);
              setVoiceChannel(null);
            }
            void loadGroups();
          }}
        />
      )}
      <PromptModal
        open={promptKind === "create"}
        title="Novo grupo"
        label="Nome do grupo"
        placeholder="ex: rolê da sexta"
        confirmLabel="Criar"
        onClose={() => setPromptKind(null)}
        onConfirm={(name) => void createGroup(name)}
      />
      <InvitePreviewModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onJoined={(groupId) => void handleJoined(groupId)}
      />
      <PromptModal
        open={promptKind === "addFriend"}
        title="Adicionar amigo"
        label="Username"
        placeholder="ex: molezinha"
        confirmLabel="Enviar pedido"
        onClose={() => setPromptKind(null)}
        onConfirm={(username) => void addFriendById(username)}
      />
      <PromptModal
        open={Boolean(memberModeration)}
        title={
          memberModeration?.ban
            ? `Banir ${memberModeration.name}?`
            : `Expulsar ${memberModeration?.name}?`
        }
        label="Motivo (opcional)"
        placeholder="ex: flood no chat"
        confirmLabel={memberModeration?.ban ? "Banir" : "Expulsar"}
        allowEmpty
        danger={Boolean(memberModeration?.ban)}
        onClose={() => setMemberModeration(null)}
        onConfirm={(reason) => {
          if (!memberModeration) return;
          const { userId, ban } = memberModeration;
          setMemberModeration(null);
          void moderateMemberFromPopout(userId, ban, reason);
        }}
      />
      <ForwardDestinationModal
        open={Boolean(forwardSource)}
        dmRecents={dmRecents}
        groups={groups}
        channelsByGroup={forwardChannelsByGroup}
        onClose={() => setForwardSource(null)}
        onPick={(dest) => void handleForward(dest)}
      />
      {showChat && (
        <SearchModal
          open={searchOpen}
          scope={view.kind === "dm" ? "dm" : "channel"}
          scopeId={view.kind === "dm" ? view.conversationId : view.kind === "channel" ? view.channel.id : ""}
          title={
            view.kind === "dm"
              ? view.other.display_name
              : view.kind === "channel"
                ? `#${view.channel.name}`
                : ""
          }
          onClose={() => setSearchOpen(false)}
          onJump={jumpToMessage}
        />
      )}
      {user && (
        <BookmarksPanel
          open={bookmarksOpen}
          userId={user.id}
          onClose={() => setBookmarksOpen(false)}
          onOpenChannelMessage={(channelId, messageId) =>
            void openChannelMessage(channelId, messageId)
          }
          onOpenDmMessage={openDmMessage}
        />
      )}
      <PollComposerModal
        open={pollOpen}
        onClose={() => setPollOpen(false)}
        onCreate={(question, options) => void createPoll(question, options)}
      />
    </>
  );
}
