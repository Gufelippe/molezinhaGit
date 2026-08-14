import { useEffect, useState } from "react";
import type { InvitePreview } from "@molezinha/shared";
import { supabase } from "../lib/supabase";
import { IconClose } from "./Icons";

interface Props {
  open: boolean;
  initialCode?: string;
  onClose: () => void;
  onJoined: (groupId: string) => void;
}

export function InvitePreviewModal({ open, initialCode = "", onClose, onJoined }: Props) {
  const [code, setCode] = useState(initialCode);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(initialCode);
    setPreview(null);
    setStatus(null);
  }, [open, initialCode]);

  useEffect(() => {
    if (!open) return;
    const c = code.trim();
    if (c.length < 4) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        const { data, error } = await supabase.rpc("preview_group_invite", { p_code: c });
        if (error) {
          setPreview(null);
          return;
        }
        const row = Array.isArray(data) ? data[0] : data;
        setPreview(row as InvitePreview);
      })();
    }, 250);
    return () => clearTimeout(t);
  }, [code, open]);

  if (!open) return null;

  async function join() {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    setStatus(null);
    const { data, error } = await supabase.rpc("join_group_by_invite", { p_code: c });
    setBusy(false);
    if (error) {
      const raw = error.message.toLowerCase();
      if (raw.includes("banned")) {
        setStatus("Você está banido deste servidor.");
      } else if (raw.includes("expired")) {
        setStatus("Este convite expirou.");
      } else if (raw.includes("exhausted")) {
        setStatus("Este convite esgotou os usos.");
      } else if (raw.includes("invalid")) {
        setStatus("Convite inválido.");
      } else {
        setStatus(error.message);
      }
      return;
    }
    onJoined(data as string);
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="neo-panel invite-preview-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="side-panel-head">
          <strong>Entrar com convite</strong>
          <button type="button" className="neo-btn neo-btn-icon" onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </div>
        <label className="muted">Código</label>
        <input
          className="neo-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="cole o código"
          autoFocus
        />
        {preview && (
          <div
            className="invite-preview-card"
            style={{
              borderColor: preview.accent_color ?? undefined,
              ["--invite-accent" as string]: preview.accent_color ?? "var(--neo-accent)",
            }}
          >
            <div className="invite-preview-icon">
              {preview.icon_url ? (
                <img src={preview.icon_url} alt="" />
              ) : (
                <span>{(preview.name ?? "?").slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            <div>
              <strong>{preview.name ?? "Grupo"}</strong>
              <div className="muted">
                {preview.invite_valid
                  ? `${preview.member_count} membros`
                  : "Convite inválido ou expirado"}
              </div>
            </div>
          </div>
        )}
        {status && <p className="error-text">{status}</p>}
        <button
          type="button"
          className="neo-btn neo-btn-primary neo-btn-block"
          disabled={busy || !preview?.invite_valid}
          onClick={() => void join()}
        >
          {busy ? "Entrando…" : "Entrar no grupo"}
        </button>
      </div>
    </div>
  );
}
