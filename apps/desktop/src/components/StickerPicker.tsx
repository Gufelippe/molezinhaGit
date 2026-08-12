import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Sticker } from "@molezinha/shared";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { MEDIA_LIMITS, validateImageFile } from "../lib/mediaLimits";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (sticker: Sticker) => void;
}

export function StickerPicker({ open, onClose, onPick }: Props) {
  const { user } = useAuth();
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("user_stickers")
      .select("created_at, stickers(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      // Fallback if migration not applied yet
      const legacy = await supabase
        .from("stickers")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });
      if (legacy.error) {
        setStatus(error.message);
        return;
      }
      setStickers((legacy.data as Sticker[]) ?? []);
      return;
    }
    const rows = (data ?? [])
      .map((row) => {
        const raw = row as unknown as { stickers: Sticker | Sticker[] | null };
        return Array.isArray(raw.stickers) ? raw.stickers[0] : raw.stickers;
      })
      .filter(Boolean) as Sticker[];
    setStickers(rows);
  }, [user]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, load, onClose]);

  if (!open) return null;

  async function createSticker(file: File) {
    if (!user) return;
    const check = await validateImageFile(file, "sticker");
    if (!check.ok) {
      setStatus(check.message);
      return;
    }
    const clean = name.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 32);
    if (!clean) {
      setStatus("Dê um nome à figurinha.");
      return;
    }
    setBusy(true);
    setStatus(null);
    const path = `${user.id}/${crypto.randomUUID()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("stickers").upload(path, file, {
      upsert: false,
      contentType: file.type,
    });
    if (upErr) {
      setBusy(false);
      setStatus(upErr.message);
      return;
    }
    const { data: pub } = supabase.storage.from("stickers").getPublicUrl(path);
    const bmp = await createImageBitmap(file);
    const { data, error } = await supabase
      .from("stickers")
      .insert({
        owner_id: user.id,
        name: clean,
        file_url: pub.publicUrl,
        mime_type: file.type,
        width: bmp.width,
        height: bmp.height,
        byte_size: file.size,
      })
      .select("*")
      .single();
    bmp.close();
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setCreating(false);
    setName("");
    setStickers((prev) => [data as Sticker, ...prev]);
  }

  async function removeFromCollection(sticker: Sticker, e: ReactMouseEvent) {
    e.stopPropagation();
    if (!user) return;
    if (sticker.owner_id === user.id) {
      // Owner deletes the asset (removes for everyone who saved it)
      const ok = window.confirm(
        `Excluir "${sticker.name}"? Quem salvou também perde o acesso (o arquivo é único).`
      );
      if (!ok) return;
      await supabase.from("stickers").delete().eq("id", sticker.id).eq("owner_id", user.id);
    } else {
      await supabase.rpc("unsave_sticker", { p_sticker_id: sticker.id });
    }
    setStickers((prev) => prev.filter((s) => s.id !== sticker.id));
  }

  return (
    <div className="sticker-picker" ref={rootRef}>
      <div className="stack-row" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <strong>Figurinhas</strong>
        <button
          className="neo-btn"
          type="button"
          style={{ padding: "0.35rem 0.65rem" }}
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? "Cancelar" : "Criar"}
        </button>
      </div>
      {status && (
        <p className="muted" style={{ fontSize: "0.8rem" }}>
          {status}
        </p>
      )}
      {creating && (
        <div style={{ marginBottom: "0.75rem" }}>
          <input
            className="neo-input"
            placeholder="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
          />
          <input
            ref={fileRef}
            type="file"
            accept={MEDIA_LIMITS.sticker.accept}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void createSticker(f);
              e.target.value = "";
            }}
          />
          <button
            className="neo-btn neo-btn-primary"
            type="button"
            disabled={busy}
            style={{ marginTop: "0.5rem", width: "100%" }}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Enviando…" : "Escolher imagem / GIF"}
          </button>
        </div>
      )}
      <div className="sticker-grid">
        {stickers.length === 0 && !creating && (
          <p className="muted" style={{ fontSize: "0.82rem", gridColumn: "1 / -1" }}>
            Nenhuma figurinha na sua coleção.
          </p>
        )}
        {stickers.map((s) => (
          <div key={s.id} className="sticker-cell">
            <button
              type="button"
              className="sticker-btn"
              title={s.name}
              onClick={() => {
                onPick(s);
                onClose();
              }}
            >
              <img src={s.file_url} alt={s.name} loading="lazy" decoding="async" />
            </button>
            <button
              type="button"
              className="sticker-remove"
              title={s.owner_id === user?.id ? "Excluir figurinha" : "Remover da coleção"}
              onClick={(e) => void removeFromCollection(s, e)}
            >
              ×
            </button>
            {s.owner_id !== user?.id && (
              <span className="sticker-saved-tag" title="Salva (referência)">
                salva
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
