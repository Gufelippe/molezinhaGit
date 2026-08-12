import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b]
      .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  };
}

function normalizeHex(raw: string, fallback = "#808080") {
  const t = raw.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(t)) return `#${t.toLowerCase()}`;
  return fallback;
}

interface Props {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  "aria-label"?: string;
}

export function NeoColorField({ value, onChange, label, "aria-label": ariaLabel }: Props) {
  const hex = normalizeHex(value);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const [hexDraft, setHexDraft] = useState(hex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const hsv = useMemo(() => {
    const rgb = hexToRgb(hex) ?? { r: 128, g: 128, b: 128 };
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  }, [hex]);

  const [h, setH] = useState(hsv.h);
  const [s, setS] = useState(hsv.s);
  const [v, setV] = useState(hsv.v);

  useEffect(() => {
    setH(hsv.h);
    setS(hsv.s);
    setV(hsv.v);
    setHexDraft(hex);
  }, [hex, hsv.h, hsv.s, hsv.v]);

  function emit(nh: number, ns: number, nv: number) {
    const rgb = hsvToRgb(nh, ns, nv);
    const next = rgbToHex(rgb.r, rgb.g, rgb.b);
    setHexDraft(next);
    onChange(next);
  }

  function placePopover() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popW = 240;
    const popH = 280;
    const gap = 8;
    const left = clamp(rect.left, 8, window.innerWidth - popW - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < popH && spaceAbove > spaceBelow) {
      setPos({ left, bottom: window.innerHeight - rect.top + gap });
    } else {
      setPos({ left, top: rect.bottom + gap });
    }
  }

  useLayoutEffect(() => {
    if (!open) return;
    placePopover();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", placePopover);
    window.addEventListener("scroll", placePopover, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", placePopover);
      window.removeEventListener("scroll", placePopover, true);
    };
  }, [open]);

  function bindDrag(
    el: HTMLDivElement | null,
    onPos: (x: number, y: number, rect: DOMRect) => void
  ) {
    if (!el) return;
    const move = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      onPos(clientX - rect.left, clientY - rect.top, rect);
    };
    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      move(e.clientX, e.clientY);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerup", onUp);
  }

  const hueColor = useMemo(() => {
    const rgb = hsvToRgb(h, 1, 1);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }, [h]);

  return (
    <div className="neo-color-field" ref={rootRef}>
      {label && <span className="neo-color-label">{label}</span>}
      <button
        ref={triggerRef}
        type="button"
        className="neo-color-trigger"
        aria-label={ariaLabel ?? label ?? "Escolher cor"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="neo-color-swatch" style={{ background: hex }} />
        <span className="neo-color-hex">{hex}</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="neo-color-popover"
          style={{
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
          }}
        >
          <div
            ref={svRef}
            className="neo-color-sv"
            style={{ backgroundColor: hueColor }}
            onPointerDown={(e) => {
              const el = svRef.current;
              if (!el) return;
              const apply = (x: number, y: number, rect: DOMRect) => {
                const ns = clamp(x / rect.width, 0, 1);
                const nv = 1 - clamp(y / rect.height, 0, 1);
                setS(ns);
                setV(nv);
                emit(h, ns, nv);
              };
              const rect = el.getBoundingClientRect();
              apply(e.clientX - rect.left, e.clientY - rect.top, rect);
              bindDrag(el, apply);
            }}
          >
            <div className="neo-color-sv-white" />
            <div className="neo-color-sv-black" />
            <span
              className="neo-color-sv-cursor"
              style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
            />
          </div>

          <div
            ref={hueRef}
            className="neo-color-hue"
            onPointerDown={(e) => {
              const el = hueRef.current;
              if (!el) return;
              const apply = (x: number, _y: number, rect: DOMRect) => {
                const nh = clamp(x / rect.width, 0, 1) * 360;
                setH(nh);
                emit(nh, s, v);
              };
              const rect = el.getBoundingClientRect();
              apply(e.clientX - rect.left, e.clientY - rect.top, rect);
              bindDrag(el, apply);
            }}
          >
            <span className="neo-color-hue-cursor" style={{ left: `${(h / 360) * 100}%` }} />
          </div>

          <div className="neo-color-footer">
            <span className="neo-color-preview" style={{ background: hex }} />
            <input
              className="neo-input neo-color-hex-input"
              value={hexDraft}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => {
                const raw = e.target.value;
                setHexDraft(raw);
                if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
                  onChange(raw.toLowerCase());
                }
              }}
              onBlur={() => {
                const next = normalizeHex(hexDraft, hex);
                setHexDraft(next);
                onChange(next);
              }}
              aria-label="Hex"
            />
          </div>
        </div>
      )}
    </div>
  );
}
