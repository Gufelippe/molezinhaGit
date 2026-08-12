import type { RefObject } from "react";
import type { Profile } from "@molezinha/shared";
import { ProfilePopout } from "./ProfilePopout";

type Props = {
  open: boolean;
  profile: Profile | null;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onEditProfile: () => void;
};

/** Self popout from the bottom user panel */
export function UserPopout({ open, profile, anchorRef, onClose, onEditProfile }: Props) {
  return (
    <ProfilePopout
      open={open}
      profile={profile}
      anchorRef={anchorRef}
      onClose={onClose}
      placement="above"
      label="Seu perfil"
      footer={
        <button
          type="button"
          className="neo-btn neo-btn-primary neo-btn-block"
          style={{ marginTop: "0.85rem" }}
          onClick={onEditProfile}
        >
          Editar perfil
        </button>
      }
    />
  );
}
