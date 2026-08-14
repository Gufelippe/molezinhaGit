import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Sticker } from "@molezinha/shared";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { MEDIA_LIMITS, validateImageFile } from "../lib/mediaLimits";
import { ImageCropModal } from "./ImageCropModal";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (sticker: Sticker) => void;
}

function storageMessage(raw: string) {
  if (/row-level security|violates/i.test(raw)) {
    return "O banco recusou o upload da figurinha. Rode as migrations do storage (stickers).";
  }
  return raw;
}

export function StickerPicker({ open, onClose, onPick }: Props) {
  const { user } = useAuth();
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const holdOpenRef = useRef(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("user_stickers")
      .select("created_at, stickers(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
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
    if (!open) {
      setCropFile(null);
      holdOpenRef.current = false;
      return;
    }
    void load();
    const onDoc = (e: MouseEvent) => {
      if (holdOpenRef.current || cropFile || busy) return;
      const target = e.target as Node | null;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".crop-modal, .settings-overlay-modal")) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, load, onClose, cropFile, busy]);

  async function uploadSticker(file: File) {
    if (!user) return;
    const clean = name.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 32) || "figurinha";
    setBusy(true);
    setStatus(null);
    const ext = file.type === "image/gif" ? "gif" : file.type === "image/png" ? "png" : "webp";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("stickers").upload(path, file, {
      upsert: false,
      contentType: file.type || "image/webp",
    });
    if (upErr) {
      setBusy(false);
      setStatus(storageMessage(upErr.message));
      return;
    }
    const { data: pub } = supabase.storage.from("stickers").getPublicUrl(path);
    let width: number | null = null;
    let height: number | null = null;
    try {
      const bmp = await createImageBitmap(file);
      width = bmp.width;
      height = bmp.height;
      bmp.close();
    } catch {
      /* dimensions are optional */
    }
    const { data, error } = await supabase
      .from("stickers")
      .insert({
        owner_id: user.id,
        name: clean.slice(0, 32),
        file_url: pub.publicUrl,
        mime_type: file.type || "image/webp",
        width,
        height,
        byte_size: file.size,
      })
      .select("*")
      .single();
    if (error) {
      setBusy(false);
      setStatus(storageMessage(error.message));
      return;
    }
    const sticker = data as Sticker;
    await supabase
      .from("user_stickers")
      .insert({ user_id: user.id, sticker_id: sticker.id })
      .then(({ error: collectErr }) => {
        if (collectErr && !/duplicate|unique/i.test(collectErr.message)) {
          console.warn("[sticker] user_stickers insert", collectErr);
        }
      });
    setBusy(false);
    setCreating(false);
    setName("");
    setCropFile(null);
    setStickers((prev) => [sticker, ...prev.filter((s) => s.id !== sticker.id)]);
  }

  async function stageFile(file: File) {
    const accepted = MEDIA_LIMITS.sticker.accept.split(",");
    if (!accepted.includes(file.type)) {
      setStatus("Formato inválido. Use PNG, JPEG, WebP ou GIF.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setStatus("Arquivo grande demais (máx. 25 MB).");
      return;
    }
    // Animated GIFs that already fit the sticker budget skip the cropper.
    if (file.type === "image/gif") {
      const check = await validateImageFile(file, "sticker");
      if (check.ok) {
        await uploadSticker(file);
        return;
      }
    }
    setCropFile(file);
  }

  async function removeFromCollection(sticker: Sticker, e: ReactMouseEvent) {
    e.stopPropagation();
    if (!user) return;
    if (sticker.owner_id === user.id) {
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

  if (!open) return null;

  return (
    <>
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
                e.target.value = "";
                holdOpenRef.current = false;
                if (f) void stageFile(f);
              }}
            />
            <button
              className="neo-btn neo-btn-primary"
              type="button"
              disabled={busy}
              style={{ marginTop: "0.5rem", width: "100%" }}
              onClick={() => {
                holdOpenRef.current = true;
                fileRef.current?.click();
                window.setTimeout(() => {
                  if (!cropFile) holdOpenRef.current = false;
                }, 800);
              }}
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
      <ImageCropModal
        open={Boolean(cropFile)}
        file={cropFile}
        kind="sticker"
        onCancel={() => setCropFile(null)}
        onConfirm={(file) => {
          setCropFile(null);
          void uploadSticker(file);
        }}
      />
    </>
  );
}
