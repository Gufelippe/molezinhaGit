import { useEffect, useRef, useState } from "react";
import type { SearchMessageHit } from "@molezinha/shared";
import { supabase } from "../lib/supabase";
import { formatChatTime } from "../lib/datetime";
import { EmptyState } from "./EmptyState";
import { SkeletonList } from "./Skeleton";
import { IconClose, IconSearch } from "./Icons";

interface Props {
  open: boolean;
  scope: "channel" | "dm";
  scopeId: string;
  title: string;
  onClose: () => void;
  onJump: (messageId: string) => void;
}

export function SearchModal({ open, scope, scopeId, title, onClose, onJump }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchMessageHit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        setBusy(true);
        const { data, error } = await supabase.rpc("search_messages", {
          p_scope: scope,
          p_id: scopeId,
          p_query: q,
          p_limit: 40,
        });
        setBusy(false);
        if (error) {
          setHits([]);
          return;
        }
        setHits((data as SearchMessageHit[]) ?? []);
      })();
    }, 220);
    return () => clearTimeout(t);
  }, [open, query, scope, scopeId]);

  if (!open) return null;

  return (
    <div className="modal-backdrop search-modal-backdrop" onMouseDown={onClose}>
      <div
        className="neo-panel search-modal"
        role="dialog"
        aria-label="Buscar mensagens"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="side-panel-head">
          <strong>
            <IconSearch /> Buscar em {title}
          </strong>
          <button type="button" className="neo-btn neo-btn-icon" aria-label="Fechar" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <input
          ref={inputRef}
          className="neo-input"
          placeholder="Digite para buscar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="search-results">
          {busy && <SkeletonList rows={3} />}
          {!busy && query.trim() && hits.length === 0 && (
            <EmptyState
              art="search"
              title="Nenhum resultado"
              hint="Tente outra palavra ou troque o filtro de canal."
            />
          )}
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              className="search-hit"
              onClick={() => {
                onJump(h.id);
                onClose();
              }}
            >
              <div className="search-hit-meta">
                <strong>{h.author_display_name}</strong>
                <span className="muted">{formatChatTime(h.created_at)}</span>
              </div>
              <div className="muted">{h.content.slice(0, 160)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
