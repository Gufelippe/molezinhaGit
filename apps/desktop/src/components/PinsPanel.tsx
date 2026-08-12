import { useEffect, useState } from "react";
import type { Message } from "@molezinha/shared";
import { supabase } from "../lib/supabase";
import { formatChatTime } from "../lib/datetime";
import { EmptyState } from "./EmptyState";
import { SkeletonList } from "./Skeleton";
import { IconClose, IconPin } from "./Icons";

type PinRow = {
  message_id: string;
  pinned_at: string;
  message: Message | null;
};

interface Props {
  open: boolean;
  channelId: string;
  onClose: () => void;
  onJump: (messageId: string) => void;
}

export function PinsPanel({ open, channelId, onClose, onJump }: Props) {
  const [rows, setRows] = useState<PinRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data: pins } = await supabase
        .from("channel_pins")
        .select("message_id, pinned_at")
        .eq("channel_id", channelId)
        .order("pinned_at", { ascending: false });
      if (!pins?.length) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }
      const ids = pins.map((p) => p.message_id as string);
      const { data: messages } = await supabase
        .from("messages")
        .select("*, profiles:author_id(id, display_name, avatar_url, username)")
        .in("id", ids);
      const byId = new Map((messages as Message[] | null)?.map((m) => [m.id, m]) ?? []);
      if (!cancelled) {
        setRows(
          pins.map((p) => ({
            message_id: p.message_id as string,
            pinned_at: p.pinned_at as string,
            message: byId.get(p.message_id as string) ?? null,
          }))
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, channelId]);

  if (!open) return null;

  return (
    <div className="side-panel pins-panel" role="dialog" aria-label="Mensagens fixadas">
      <div className="side-panel-head">
        <strong>
          <IconPin /> Fixadas
        </strong>
        <button type="button" className="neo-btn neo-btn-icon" aria-label="Fechar" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="side-panel-body">
        {loading && <SkeletonList rows={3} />}
        {!loading && rows.length === 0 && (
          <EmptyState
            art="pins"
            title="Nada fixado aqui"
            hint="Fixe uma mensagem pelo menu para deixá-la sempre à mão."
          />
        )}
        {rows.map((r) => (
          <button
            key={r.message_id}
            type="button"
            className="pin-item"
            onClick={() => {
              onJump(r.message_id);
              onClose();
            }}
          >
            <div className="pin-item-meta">
              <strong>{r.message?.profiles?.display_name ?? "Mensagem"}</strong>
              <span className="muted">{formatChatTime(r.pinned_at)}</span>
            </div>
            <div className="pin-item-preview muted">
              {r.message?.sticker_id
                ? "Figurinha"
                : (r.message?.content ?? "Mensagem removida").slice(0, 140)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
