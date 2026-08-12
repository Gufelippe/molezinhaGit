import { useState } from "react";
import { hotkeyFromKeyboardEvent } from "../lib/desktopNative";

type Props = {
  label: string;
  value: string;
  fallback?: string;
  unavailable?: string;
  onChange: (value: string) => void;
};

export function HotkeyRecorder({ label, value, fallback, unavailable, onChange }: Props) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="hotkey-field">
      <span className="hotkey-label">{label}</span>
      <div className="hotkey-row">
        <button
          type="button"
          className={`hotkey-recorder ${recording ? "recording" : ""}`}
          aria-label={`${label}: ${value || "desativado"}`}
          onClick={() => {
            setError(null);
            setRecording(true);
          }}
          onBlur={() => setRecording(false)}
          onKeyDown={(event) => {
            if (!recording) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") {
              setRecording(false);
              return;
            }
            if (event.key === "Backspace" || event.key === "Delete") {
              onChange("");
              setError(null);
              setRecording(false);
              return;
            }
            const next = hotkeyFromKeyboardEvent(event.nativeEvent);
            if (!next) {
              setError("Use uma tecla junto com Ctrl, Alt ou Shift.");
              return;
            }
            if (unavailable && next === unavailable) {
              setError("Esse atalho já está sendo usado.");
              return;
            }
            onChange(next);
            setError(null);
            setRecording(false);
          }}
        >
          {recording ? (
            <span className="hotkey-capture">Pressione as teclas…</span>
          ) : value ? (
            value.split("+").map((part) => <kbd key={part}>{part}</kbd>)
          ) : (
            <span className="hotkey-empty">Desativado</span>
          )}
        </button>
        {value && (
          <button
            type="button"
            className="hotkey-clear"
            aria-label={`Desativar ${label}`}
            onClick={() => {
              onChange("");
              setError(null);
            }}
          >
            Limpar
          </button>
        )}
        {!value && fallback && (
          <button
            type="button"
            className="hotkey-clear"
            onClick={() => {
              onChange(fallback);
              setError(null);
            }}
          >
            Usar padrão
          </button>
        )}
      </div>
      {error && <span className="hotkey-error">{error}</span>}
    </div>
  );
}
