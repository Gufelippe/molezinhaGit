import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { CROP_TARGETS, cropImageToFile, type CropKind } from "../lib/imageCrop";
import { NeoRange } from "./NeoControls";

const VIEW_MAX_W = 380;
const VIEW_MAX_H = 340;
const MAX_ZOOM = 4;

type Point = { x: number; y: number };
type Source = { url: string; w: number; h: number };

interface Props {
  open: boolean;
  file: File | null;
  kind: CropKind;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

/** Discord-style cropper: pan + zoom over a fixed frame, exports a resized file. */
export function ImageCropModal({ open, file, kind, onCancel, onConfirm }: Props) {
  const target = CROP_TARGETS[kind];
  const [source, setSource] = useState<Source | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointer: number; from: Point; origin: Point } | null>(null);

  const view = useMemo(() => {
    const aspect = target.width / target.height;
    let w = VIEW_MAX_W;
    let h = w / aspect;
    if (h > VIEW_MAX_H) {
      h = VIEW_MAX_H;
      w = h * aspect;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }, [target]);

  const geometry = useMemo(() => {
    if (!source) return null;
    const base = Math.max(view.w / source.w, view.h / source.h);
    const scale = base * zoom;
    return { base, scale, dispW: source.w * scale, dispH: source.h * scale };
  }, [source, zoom, view]);

  const clampOffset = useCallback(
    (next: Point, dispW: number, dispH: number): Point => ({
      x: Math.min(0, Math.max(view.w - dispW, next.x)),
      y: Math.min(0, Math.max(view.h - dispH, next.y)),
    }),
    [view]
  );

  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      const base = Math.max(view.w / img.naturalWidth, view.h / img.naturalHeight);
      setSource({ url, w: img.naturalWidth, h: img.naturalHeight });
      setZoom(1);
      setOffset({
        x: (view.w - img.naturalWidth * base) / 2,
        y: (view.h - img.naturalHeight * base) / 2,
      });
    };
    img.onerror = () => {
      if (!cancelled) setError("Não foi possível abrir a imagem.");
    };
    img.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
      imageRef.current = null;
      setSource(null);
      setError(null);
      setBusy(false);
    };
  }, [open, file, view]);

  const applyZoom = useCallback(
    (next: number) => {
      if (!source || !geometry) return;
      const clamped = Math.min(MAX_ZOOM, Math.max(1, next));
      const nextScale = geometry.base * clamped;
      const ratio = nextScale / geometry.scale;
      // Keep whatever sits in the middle of the frame anchored while zooming.
      const cx = view.w / 2;
      const cy = view.h / 2;
      setZoom(clamped);
      setOffset(
        clampOffset(
          { x: cx - (cx - offset.x) * ratio, y: cy - (cy - offset.y) * ratio },
          source.w * nextScale,
          source.h * nextScale
        )
      );
    },
    [source, geometry, view, offset, clampOffset]
  );

  useEffect(() => {
    const el = viewRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(zoom * (e.deltaY > 0 ? 0.92 : 1.08));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, zoom, applyZoom]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !file) return null;

  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!geometry) return;
    dragRef.current = {
      pointer: e.pointerId,
      from: { x: e.clientX, y: e.clientY },
      origin: offset,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== e.pointerId || !geometry) return;
    setOffset(
      clampOffset(
        {
          x: drag.origin.x + (e.clientX - drag.from.x),
          y: drag.origin.y + (e.clientY - drag.from.y),
        },
        geometry.dispW,
        geometry.dispH
      )
    );
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointer !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  async function confirm() {
    const image = imageRef.current;
    if (!image || !source || !geometry || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sw = Math.min(source.w, view.w / geometry.scale);
      const sh = Math.min(source.h, view.h / geometry.scale);
      const cropped = await cropImageToFile({
        image,
        crop: {
          sx: Math.min(Math.max(0, -offset.x / geometry.scale), source.w - sw),
          sy: Math.min(Math.max(0, -offset.y / geometry.scale), source.h - sh),
          sw,
          sh,
        },
        kind,
      });
      onConfirm(cropped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao recortar a imagem.");
      setBusy(false);
    }
  }

  return createPortal(
    <div className="settings-overlay settings-overlay-modal" onClick={onCancel}>
      <div className="neo-outset crop-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="crop-title">{target.title}</h2>
        <p className="muted crop-hint">{target.hint}</p>

        <div
          ref={viewRef}
          className={`crop-view ${target.shape === "round" ? "crop-view-round" : ""}`}
          style={{ width: view.w, height: view.h }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {source && geometry && (
            <img
              className="crop-image"
              src={source.url}
              alt=""
              draggable={false}
              style={{
                width: geometry.dispW,
                height: geometry.dispH,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
        </div>

        <div className="crop-zoom">
          <span className="muted">Zoom</span>
          <NeoRange
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            aria-label="Zoom da imagem"
            disabled={!source}
            onChange={applyZoom}
          />
        </div>

        {file.type === "image/gif" && (
          <p className="muted crop-note">GIFs viram imagem parada depois do recorte.</p>
        )}
        {error && <p className="crop-error">{error}</p>}

        <div className="stack-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="neo-btn" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="neo-btn neo-btn-primary"
            onClick={() => void confirm()}
            disabled={!source || busy}
          >
            {busy ? "Processando…" : "Aplicar"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
