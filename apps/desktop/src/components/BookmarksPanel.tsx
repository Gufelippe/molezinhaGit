import { useEffect, useState } from "react";
import type { Message } from "@molezinha/shared";
import { supabase } from "../lib/supabase";
import { formatChatTime } from "../lib/datetime";
import { EmptyState } from "./EmptyState";
import { SkeletonList } from "./Skeleton";
import { IconClose, IconBookmark } from "./Icons";

type BookmarkRow = {
  id: string;
  created_at: string;
  message_id: string | null;
  dm_message_id: string | null;
  message?: Message | null;
};

interface Props {
  open: boolean;
  userId: string;
  onClose: () => void;
  onOpenChannelMessage: (channelId: string, messageId: string) => void;
  onOpenDmMessage: (conversationId: string, messageId: string) => void;
}

export function BookmarksPanel({
  open,
  userId,
  onClose,
  onOpenChannelMessage,
  onOpenDmMessage,
}: Props) {
  const [rows, setRows] = useState<BookmarkRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("user_bookmarks")
        .select("id, created_at, message_id, dm_message_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(80);
      if (!data?.length) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }
      const channelIds = data.map((d) => d.message_id).filter(Boolean) as string[];
      const dmIds = data.map((d) => d.dm_message_id).filter(Boolean) as string[];
      const [chRes, dmRes] = await Promise.all([
        channelIds.length
          ? supabase
              .from("messages")
              .select("*, profiles:author_id(id, display_name, avatar_url, username)")
              .in("id", channelIds)
          : Promise.resolve({ data: [] as Message[] }),
        dmIds.length
          ? supabase
              .from("direct_messages")
              .select("*, profiles:author_id(id, display_name, avatar_url, username)")
              .in("id", dmIds)
          : Promise.resolve({ data: [] as Message[] }),
      ]);
      const chMap = new Map((chRes.data as Message[] | null)?.map((m) => [m.id, m]) ?? []);
      const dmMap = new Map((dmRes.data as Message[] | null)?.map((m) => [m.id, m]) ?? []);
      if (!cancelled) {
        setRows(
          data.map((d) => ({
            id: d.id as string,
            created_at: d.created_at as string,
            message_id: d.message_id as string | null,
            dm_message_id: d.dm_message_id as string | null,
            message: d.message_id
              ? chMap.get(d.message_id as string) ?? null
              : d.dm_message_id
                ? dmMap.get(d.dm_message_id as string) ?? null
                : null,
          }))
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  if (!open) return null;

  return (
    <div className="side-panel bookmarks-panel" role="dialog" aria-label="Salvos">
      <div className="side-panel-head">
        <strong>
          <IconBookmark /> Salvos
        </strong>
        <button type="button" className="neo-btn neo-btn-icon" onClick={onClose} aria-label="Fechar">
          <IconClose />
        </button>
      </div>
      <div className="side-panel-body">
        {loading && <SkeletonList rows={3} />}
        {!loading && rows.length === 0 && (
          <EmptyState
            art="bookmarks"
            title="Nada salvo ainda"
            hint="Use “Salvar pra mim” no menu da mensagem para guardar aqui."
          />
        )}
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            className="pin-item"
            onClick={() => {
              if (r.message_id && r.message?.channel_id) {
                onOpenChannelMessage(r.message.channel_id, r.message_id);
                onClose();
              } else if (r.dm_message_id && r.message?.conversation_id) {
                onOpenDmMessage(r.message.conversation_id, r.dm_message_id);
                onClose();
              }
            }}
          >
            <div className="pin-item-meta">
              <strong>{r.message?.profiles?.display_name ?? "Mensagem"}</strong>
              <span className="muted">{formatChatTime(r.created_at)}</span>
            </div>
            <div className="pin-item-preview muted">
              {(r.message?.content ?? "…").slice(0, 140)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
