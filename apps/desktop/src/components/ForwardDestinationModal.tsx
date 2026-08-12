import { useEffect, useMemo, useState } from "react";
import type { Channel, Group, Profile } from "@molezinha/shared";

export type ForwardDestination =
  | { kind: "dm"; conversationId: string; other: Profile }
  | { kind: "channel"; channel: Channel; groupName: string };

type DmRecent = { conversationId: string; other: Profile };

interface Props {
  open: boolean;
  dmRecents: DmRecent[];
  groups: Group[];
  channelsByGroup: Map<string, Channel[]>;
  onClose: () => void;
  onPick: (dest: ForwardDestination) => void;
}

export function ForwardDestinationModal({
  open,
  dmRecents,
  groups,
  channelsByGroup,
  onClose,
  onPick,
}: Props) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const destinations = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: { key: string; label: string; sub?: string; dest: ForwardDestination }[] = [];

    for (const dm of dmRecents) {
      const label = dm.other.display_name;
      const sub = `@${dm.other.username}`;
      if (
        !q ||
        label.toLowerCase().includes(q) ||
        dm.other.username.toLowerCase().includes(q)
      ) {
        items.push({
          key: `dm:${dm.conversationId}`,
          label,
          sub,
          dest: { kind: "dm", conversationId: dm.conversationId, other: dm.other },
        });
      }
    }

    for (const g of groups) {
      const channels = (channelsByGroup.get(g.id) ?? []).filter((c) => c.type === "text");
      for (const c of channels) {
        const label = `#${c.name}`;
        const sub = g.name;
        if (!q || label.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)) {
          items.push({
            key: `ch:${c.id}`,
            label,
            sub,
            dest: { kind: "channel", channel: c, groupName: g.name },
          });
        }
      }
    }

    return items;
  }, [query, dmRecents, groups, channelsByGroup]);

  if (!open) return null;

  return (
    <div className="settings-overlay settings-overlay-modal" onClick={onClose}>
      <div
        className="neo-outset forward-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.25rem" }}>Encaminhar para</h2>
        <p className="muted" style={{ margin: "0 0 0.85rem", fontSize: "0.85rem" }}>
          Escolha um DM ou canal de texto.
        </p>
        <input
          className="neo-input"
          autoFocus
          placeholder="Buscar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="forward-dest-list">
          {destinations.length === 0 && (
            <p className="muted" style={{ padding: "0.75rem 0.25rem", margin: 0 }}>
              Nenhum destino encontrado.
            </p>
          )}
          {destinations.map((item) => (
            <button
              key={item.key}
              type="button"
              className="forward-dest-item"
              onClick={() => {
                onPick(item.dest);
                onClose();
              }}
            >
              <span className="forward-dest-label">{item.label}</span>
              {item.sub && <span className="muted forward-dest-sub">{item.sub}</span>}
            </button>
          ))}
        </div>
        <div className="stack-row" style={{ justifyContent: "flex-end", marginTop: "0.75rem" }}>
          <button type="button" className="neo-btn" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
