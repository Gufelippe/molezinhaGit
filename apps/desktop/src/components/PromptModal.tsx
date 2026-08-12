import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  title: string;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

export function PromptModal({
  open,
  title,
  label,
  placeholder,
  confirmLabel = "Confirmar",
  onClose,
  onConfirm,
}: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings-overlay settings-overlay-modal" onClick={onClose}>
      <form
        className="neo-outset"
        style={{ width: "min(400px, 92vw)", padding: "1.5rem" }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = value.trim();
          if (!trimmed) return;
          onConfirm(trimmed);
          onClose();
        }}
      >
        <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.35rem" }}>{title}</h2>
        <div className="field" style={{ marginTop: "1rem" }}>
          <label htmlFor="prompt-field">{label}</label>
          <input
            id="prompt-field"
            className="neo-input"
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="stack-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="neo-btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="neo-btn neo-btn-primary" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
