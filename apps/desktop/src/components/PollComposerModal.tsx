import { useEffect, useState } from "react";
import { IconClose } from "./Icons";

const MAX_OPTIONS = 6;

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (question: string, options: string[]) => void;
}

export function PollComposerModal({ open, onClose, onCreate }: Props) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);

  useEffect(() => {
    if (!open) return;
    setQuestion("");
    setOptions(["", ""]);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim().length > 0 && filled.length >= 2;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="neo-panel poll-modal"
        role="dialog"
        aria-label="Criar enquete"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="side-panel-head">
          <strong>Criar enquete</strong>
          <button type="button" className="neo-btn neo-btn-icon" aria-label="Fechar" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <label className="muted" htmlFor="poll-question">
          Pergunta
        </label>
        <input
          id="poll-question"
          className="neo-input"
          value={question}
          maxLength={200}
          placeholder="ex: onde a gente vai sexta?"
          autoFocus
          onChange={(e) => setQuestion(e.target.value)}
        />
        <label className="muted" style={{ marginTop: "0.75rem", display: "block" }}>
          Opções
        </label>
        <div className="poll-modal-options">
          {options.map((o, i) => (
            <div key={i} className="poll-modal-option-row">
              <input
                className="neo-input"
                value={o}
                maxLength={80}
                placeholder={`Opção ${i + 1}`}
                onChange={(e) =>
                  setOptions((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                }
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="neo-btn neo-btn-icon"
                  aria-label={`Remover opção ${i + 1}`}
                  onClick={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <IconClose />
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < MAX_OPTIONS && (
          <button
            type="button"
            className="neo-btn"
            style={{ marginTop: "0.6rem" }}
            onClick={() => setOptions((prev) => [...prev, ""])}
          >
            Adicionar opção
          </button>
        )}
        <button
          type="button"
          className="neo-btn neo-btn-primary neo-btn-block"
          style={{ marginTop: "1rem" }}
          disabled={!valid}
          onClick={() => {
            onCreate(question.trim(), filled);
            onClose();
          }}
        >
          Publicar enquete
        </button>
      </div>
    </div>
  );
}
