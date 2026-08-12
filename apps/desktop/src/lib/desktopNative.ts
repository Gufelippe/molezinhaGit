/**
 * Thin bridge to the Tauri shell (tray, OS notifications, global hotkeys).
 *
 * Every export is safe to call in a plain browser: when the app runs outside
 * Tauri the native calls are skipped and the web fallbacks are used instead.
 */

const HOTKEYS_KEY = "molezinha.hotkeys";
const APP_TITLE = "molezinha";

export type Hotkeys = {
  /** Toggles the mic on/off. */
  toggleMute: string;
  /** Held down to talk while muted. */
  pushToTalk: string;
};

export const DEFAULT_HOTKEYS: Hotkeys = {
  toggleMute: "CmdOrControl+Shift+M",
  pushToTalk: "",
};

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** Converts a keyboard event into the accelerator format accepted by Tauri. */
export function hotkeyFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;

  let key = event.key;
  if (key === " ") key = "Space";
  else if (key === "Esc") key = "Escape";
  else if (key.length === 1) key = key.toUpperCase();

  // A bare printable key would hijack normal typing system-wide.
  const hasModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
  if (!hasModifier && key.length === 1) return null;

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("CmdOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function readHotkeys(): Hotkeys {
  try {
    const raw = localStorage.getItem(HOTKEYS_KEY);
    if (!raw) return { ...DEFAULT_HOTKEYS };
    const parsed = JSON.parse(raw) as Partial<Hotkeys>;
    return {
      toggleMute:
        typeof parsed.toggleMute === "string" ? parsed.toggleMute : DEFAULT_HOTKEYS.toggleMute,
      pushToTalk:
        typeof parsed.pushToTalk === "string" ? parsed.pushToTalk : DEFAULT_HOTKEYS.pushToTalk,
    };
  } catch {
    return { ...DEFAULT_HOTKEYS };
  }
}

export function writeHotkeys(partial: Partial<Hotkeys>): Hotkeys {
  const next = { ...readHotkeys(), ...partial };
  localStorage.setItem(HOTKEYS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("molezinha:hotkeys", { detail: next }));
  return next;
}

/** Mirrors the unread count in the window title, which doubles as the taskbar label. */
export function updateWindowBadge(n: number) {
  if (typeof document === "undefined") return;
  const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const label = count > 99 ? "99+" : String(count);
  document.title = count > 0 ? `(${label}) ${APP_TITLE}` : APP_TITLE;
}

/** Titles of notifications we sent, so a click can be routed back to a handler. */
const notificationClicks = new Map<string, () => void>();
let actionListenerReady = false;

async function ensureActionListener() {
  if (actionListenerReady) return;
  actionListenerReady = true;
  try {
    const { onAction } = await import("@tauri-apps/plugin-notification");
    await onAction((notification) => {
      const handler = notification.title ? notificationClicks.get(notification.title) : undefined;
      notificationClicks.clear();
      void focusMainWindow();
      handler?.();
    });
  } catch (err) {
    console.warn("[native] notification action listener unavailable", err);
  }
}

export async function focusMainWindow() {
  if (!isTauri()) {
    window.focus();
    return;
  }
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.show();
    await win.unminimize();
    await win.setFocus();
  } catch (err) {
    console.warn("[native] focusMainWindow failed", err);
  }
}

export type NativeNotification = {
  title: string;
  body: string;
  onClick?: () => void;
};

/**
 * Sends an OS notification through Tauri, falling back to the Web Notification
 * API (which is what the browser build and older installs rely on).
 */
export async function showNativeNotification({ title, body, onClick }: NativeNotification) {
  if (!isTauri()) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") {
      const result = await Notification.requestPermission().catch(() => "denied");
      if (result !== "granted") return;
    }
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
    return;
  }

  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;
    if (onClick) {
      notificationClicks.set(title, onClick);
      void ensureActionListener();
    }
    sendNotification({ title, body });
  } catch (err) {
    console.warn("[native] showNativeNotification failed", err);
  }
}

export type ShortcutHandlers = {
  onToggleMute?: () => void;
  /** Called with `true` on key down and `false` on key up. */
  onPushToTalk?: (active: boolean) => void;
};

/**
 * Binds the configured global hotkeys. Returns a cleanup function; a no-op when
 * running outside Tauri or when no hotkey is configured.
 */
export async function registerGlobalShortcuts(
  handlers: ShortcutHandlers,
  hotkeys: Hotkeys = readHotkeys()
): Promise<() => void> {
  if (!isTauri()) return () => undefined;

  let plugin: typeof import("@tauri-apps/plugin-global-shortcut");
  try {
    plugin = await import("@tauri-apps/plugin-global-shortcut");
  } catch (err) {
    console.warn("[native] global shortcut plugin unavailable", err);
    return () => undefined;
  }

  const registered = new Set<string>();

  const bind = async (accelerator: string, handler: (state: "Pressed" | "Released") => void) => {
    if (!accelerator) return;
    try {
      // A stale registration from a previous session would make register() throw.
      if (await plugin.isRegistered(accelerator)) {
        await plugin.unregister(accelerator);
      }
      await plugin.register(accelerator, (event) => handler(event.state));
      registered.add(accelerator);
    } catch (err) {
      console.warn("[native] could not register hotkey", accelerator, err);
    }
  };

  if (handlers.onToggleMute) {
    await bind(hotkeys.toggleMute, (state) => {
      if (state === "Pressed") handlers.onToggleMute?.();
    });
  }
  if (handlers.onPushToTalk) {
    if (hotkeys.pushToTalk !== hotkeys.toggleMute) {
      await bind(hotkeys.pushToTalk, (state) => {
        handlers.onPushToTalk?.(state === "Pressed");
      });
    }
  }

  return () => {
    for (const accelerator of registered) {
      void plugin.unregister(accelerator).catch(() => undefined);
    }
  };
}

export type UpdateCheckResult =
  | { status: "unavailable" }
  | { status: "upToDate" }
  | { status: "available"; version: string; downloadAndInstall: () => Promise<void> }
  | { status: "error"; message: string };

/** Checks GitHub Releases via tauri-plugin-updater. No-op outside Tauri. */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isTauri()) return { status: "unavailable" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { status: "upToDate" };
    return {
      status: "available",
      version: update.version,
      downloadAndInstall: async () => {
        await update.downloadAndInstall();
        // On Windows the NSIS installer already relaunches the app (/R or
        // basicUi auto-launch). Calling relaunch() here races the installer
        // and can reopen a half-replaced binary as a black window.
        const isWindows = navigator.userAgent.includes("Windows");
        if (!isWindows) {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        }
      },
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Falha ao checar atualização",
    };
  }
}
