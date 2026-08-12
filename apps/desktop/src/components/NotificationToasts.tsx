import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ToastPayload } from "../lib/notifications";
import { Avatar } from "./Avatar";

interface Props {
  toasts: ToastPayload[];
  onDismiss: (id: string) => void;
}

const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;

export const NotificationToasts = memo(function NotificationToasts({ toasts, onDismiss }: Props) {
  return (
    <div className="notif-toast-stack" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            layout
            initial={{ opacity: 0, x: 32, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.96 }}
            transition={SPRING}
            className={`notif-toast notif-toast-${t.kind}`}
            onClick={() => {
              t.onOpen();
              onDismiss(t.id);
            }}
          >
            <Avatar size="sm" name={t.title} url={t.avatarUrl} className="notif-toast-avatar" />
            <div className="notif-toast-body">
              <strong>{t.title}</strong>
              <span>{t.body}</span>
            </div>
            <span
              className="notif-toast-close"
              role="presentation"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(t.id);
              }}
            >
              ×
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
});
