import { useEffect, useMemo, useRef, useState } from "react";
import { searchEmojis, type CatId } from "./emojiSearch";

const CATEGORIES: { id: CatId; label: string; title: string }[] = [
  { id: "smileys", label: "😀", title: "Rostos" },
  { id: "people", label: "👋", title: "Pessoas" },
  { id: "animals", label: "🐱", title: "Animais" },
  { id: "food", label: "🍕", title: "Comida" },
  { id: "activities", label: "⚽", title: "Atividades" },
  { id: "travel", label: "✈️", title: "Viagem" },
  { id: "objects", label: "💡", title: "Objetos" },
  { id: "symbols", label: "❤️", title: "Símbolos" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
}

export function EmojiPicker({ open, onClose, onPick }: Props) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<CatId>("smileys");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const list = useMemo(() => searchEmojis(q, cat), [q, cat]);

  if (!open) return null;

  return (
    <div className="emoji-picker" ref={rootRef}>
      <div className="emoji-picker-head">
        <input
          className="emoji-picker-search"
          placeholder="Buscar (ex: pizza, feliz, gato)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          aria-label="Buscar emoji"
        />
        {!q.trim() && (
          <div className="emoji-cats" role="tablist">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={cat === c.id}
                className={`emoji-cat ${cat === c.id ? "active" : ""}`}
                onClick={() => setCat(c.id)}
                title={c.title}
              >
                <span className="emoji-glyph">{c.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="emoji-grid" role="listbox" aria-label="Emojis">
        {list.length === 0 ? (
          <p className="emoji-empty muted">Nada encontrado</p>
        ) : (
          list.map((glyph) => (
            <button
              key={glyph}
              type="button"
              className="emoji-btn"
              onClick={() => {
                onPick(glyph);
                onClose();
              }}
            >
              <span className="emoji-glyph" aria-hidden>
                {glyph}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
