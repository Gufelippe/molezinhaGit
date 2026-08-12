import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Side = "right" | "bottom" | "top";

interface Props {
  label: string;
  children: ReactNode;
  side?: Side;
}

const OPEN_DELAY_MS = 550;
const GAP_PX = 10;
const EDGE_PX = 8;

/** Custom hover label — replaces native browser tooltips.
 *  Rendered through a portal so scrollable panels never clip it. */
export function NeoTooltip({ label, children, side = "right" }: Props) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    cancelTimer();
    setAnchor(null);
  }, [cancelTimer]);

  const place = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (side === "right") setAnchor({ top: rect.top + rect.height / 2, left: rect.right + GAP_PX });
    else if (side === "bottom") setAnchor({ top: rect.bottom + GAP_PX, left: rect.left + rect.width / 2 });
    else setAnchor({ top: rect.top - GAP_PX, left: rect.left + rect.width / 2 });
  }, [side]);

  const show = useCallback(() => {
    cancelTimer();
    timerRef.current = window.setTimeout(place, OPEN_DELAY_MS);
  }, [cancelTimer, place]);

  useEffect(() => cancelTimer, [cancelTimer]);

  useEffect(() => {
    if (!anchor) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [anchor, hide]);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    tip.style.marginLeft = "";
    tip.style.marginTop = "";
    const rect = tip.getBoundingClientRect();
    const overflowLeft = EDGE_PX - rect.left;
    const overflowRight = rect.right - (window.innerWidth - EDGE_PX);
    const overflowTop = EDGE_PX - rect.top;
    const overflowBottom = rect.bottom - (window.innerHeight - EDGE_PX);
    if (overflowLeft > 0) tip.style.marginLeft = `${overflowLeft}px`;
    else if (overflowRight > 0) tip.style.marginLeft = `${-overflowRight}px`;
    if (overflowTop > 0) tip.style.marginTop = `${overflowTop}px`;
    else if (overflowBottom > 0) tip.style.marginTop = `${-overflowBottom}px`;
  }, [anchor]);

  if (!label) return <>{children}</>;

  return (
    <span
      ref={wrapRef}
      className="neo-tooltip-wrap"
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") show();
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={place}
      onBlur={hide}
    >
      {children}
      {anchor !== null &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            className={`neo-tooltip neo-tooltip-${side}`}
            style={{ top: anchor.top, left: anchor.left }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
