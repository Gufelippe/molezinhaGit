import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export interface NeoSelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: NeoSelectOption[];
  placeholder?: string;
  onChange: (value: string) => void;
  "aria-label"?: string;
}

const MENU_MAX = 220;
const GAP = 8;

export function NeoSelect({
  value,
  options,
  placeholder = "Selecionar",
  onChange,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  function updatePlacement() {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    const spaceAbove = rect.top - GAP;
    const need = Math.min(MENU_MAX, options.length * 44 + 16);
    // Prefer down; flip up when below doesn't fit and above has more room
    setDropUp(spaceBelow < need && spaceAbove > spaceBelow);
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePlacement();
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => updatePlacement();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, options.length]);

  return (
    <div className={`neo-select-root ${dropUp ? "neo-select-up" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="neo-select-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{selected?.label ?? placeholder}</span>
        <span className="neo-select-chevron" aria-hidden />
      </button>
      {open && (
        <div
          className={`neo-select-menu ${dropUp ? "neo-select-menu-up" : ""}`}
          id={listId}
          role="listbox"
        >
          {options.map((opt) => (
            <button
              key={opt.value || "__empty"}
              type="button"
              role="option"
              className="neo-select-option"
              aria-selected={opt.value === value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
