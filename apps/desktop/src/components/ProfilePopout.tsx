import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Profile } from "@molezinha/shared";
import { ProfileCard } from "./ProfileCard";
import { splitPresence } from "../lib/presence";

type Placement = "above" | "left";

type Props = {
  open: boolean;
  profile: Profile | null;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  placement?: Placement;
  footer?: ReactNode;
  label?: string;
};

const CARD_W = 340;
const GAP = 10;
const MARGIN = 12;

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function samePos(
  a: { left: number; top: number; width: number } | null,
  left: number,
  top: number,
  width: number
) {
  return Boolean(a && a.left === left && a.top === top && a.width === width);
}

export function ProfilePopout({
  open,
  profile,
  anchorRef,
  onClose,
  placement = "above",
  footer,
  label = "Perfil",
}: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(CARD_W, vw - MARGIN * 2);
      const measured = popRef.current?.offsetHeight ?? 0;
      const height = measured || 420;
      const maxTop = Math.max(MARGIN, vh - height - MARGIN);

      let left: number;
      let top: number;

      if (placement === "above") {
        left = clamp(rect.left, MARGIN, Math.max(MARGIN, vw - width - MARGIN));
        const above = rect.top - GAP - height;
        const below = rect.bottom + GAP;
        if (above >= MARGIN) top = above;
        else if (below + height <= vh - MARGIN) top = below;
        else top = clamp(above, MARGIN, maxTop);
      } else {
        const toLeft = rect.left - GAP - width;
        const toRight = rect.right + GAP;
        if (toLeft >= MARGIN) left = toLeft;
        else if (toRight + width <= vw - MARGIN) left = toRight;
        else left = clamp(toRight, MARGIN, Math.max(MARGIN, vw - width - MARGIN));
        left = clamp(left, MARGIN, Math.max(MARGIN, vw - width - MARGIN));
        top = clamp(rect.top, MARGIN, maxTop);
      }

      setPos((prev) => (samePos(prev, left, top, width) ? prev : { left, top, width }));
    };

    update();
    let ro: ResizeObserver | null = null;
    const raf = requestAnimationFrame(() => {
      update();
      if (!popRef.current) return;
      ro = new ResizeObserver(update);
      ro.observe(popRef.current);
    });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, placement, profile?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !profile || !pos) return null;

  const presence = splitPresence(profile);

  return createPortal(
    <div
      className="user-popout"
      ref={popRef}
      role="dialog"
      aria-label={label}
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
      }}
    >
      <ProfileCard
        displayName={profile.display_name}
        username={profile.username}
        bio={profile.bio}
        avatarUrl={profile.avatar_url}
        bannerUrl={profile.banner_url}
        bannerColor={profile.banner_color}
        accentColor={profile.accent_color}
        pronouns={profile.pronouns}
        customStatus={profile.custom_status}
        status={presence.status}
        inCall={presence.inCall}
        activity={profile.activity}
        footer={footer}
      />
    </div>,
    document.body
  );
}
