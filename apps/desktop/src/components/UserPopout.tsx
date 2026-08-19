import type { RefObject } from "react";
import type { PresenceStatus, Profile } from "@molezinha/shared";
import { ProfilePopout } from "./ProfilePopout";
import { STATUS_OPTIONS, splitPresence } from "../lib/presence";

type Props = {
  open: boolean;
  profile: Profile | null;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onEditProfile: () => void;
  onSetStatus?: (status: PresenceStatus) => void;
};

/** Self popout from the bottom user panel */
export function UserPopout({
  open,
  profile,
  anchorRef,
  onClose,
  onEditProfile,
  onSetStatus,
}: Props) {
  const presence = profile ? splitPresence(profile) : null;
  return (
    <ProfilePopout
      open={open}
      profile={profile}
      anchorRef={anchorRef}
      onClose={onClose}
      placement="above"
      label="Seu perfil"
      footer={
        <>
          {onSetStatus && (
            <div className="status-picker" role="listbox" aria-label="Status">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={presence?.status === opt.value}
                  className={`status-picker-btn ${presence?.status === opt.value ? "active" : ""}`}
                  onClick={() => onSetStatus(opt.value)}
                >
                  <span className={`status-dot ${opt.value === "offline" ? "offline" : opt.value}`} />
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="neo-btn neo-btn-primary neo-btn-block"
            style={{ marginTop: "0.5rem" }}
            onClick={onEditProfile}
          >
            Editar perfil
          </button>
        </>
      }
    />
  );
}
