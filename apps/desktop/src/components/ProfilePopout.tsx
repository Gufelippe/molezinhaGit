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
  const [pos, setPos] = useState<{
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
    maxHeight?: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const rect = anchorRef.current!.getBoundingClientRect();
      const gap = 10;
      if (placement === "left") {
        const maxHeight = Math.min(520, window.innerHeight - 24);
        let top = rect.top;
        if (top + maxHeight > window.innerHeight - 12) {
          top = Math.max(12, window.innerHeight - maxHeight - 12);
        }
        setPos({
          right: window.innerWidth - rect.left + gap,
          top,
          maxHeight,
        });
      } else {
        setPos({
          left: rect.left,
          bottom: window.innerHeight - rect.top + gap,
          maxHeight: Math.min(520, rect.top - 16),
        });
      }
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, placement]);

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

  return createPortal(
    <div
      className="user-popout"
      ref={popRef}
      role="dialog"
      aria-label={label}
      style={{
        left: pos.left,
        right: pos.right,
        top: pos.top,
        bottom: pos.bottom,
        maxHeight: pos.maxHeight,
        overflow: "auto",
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
        status={profile.status}
        activity={profile.activity}
        footer={footer}
      />
    </div>,
    document.body
  );
}
