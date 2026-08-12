import type { UserActivity } from "@molezinha/shared";
import { supabase } from "./supabase";
import { isTauri } from "./desktopNative";

const POLL_MS = 30_000;
const DETECT_KEY = "molezinha.activityDetect";

type ActivityRule = {
  /** Process executable name, matched case-insensitively. */
  process: string;
  label: string;
};

/**
 * Allowlist of processes we are willing to report. Nothing outside this list is
 * ever sent to the server — the Rust side only answers about names we ask for.
 */
const ACTIVITY_RULES: ActivityRule[] = [
  { process: "League of Legends.exe", label: "Jogando League of Legends" },
  { process: "VALORANT-Win64-Shipping.exe", label: "Jogando Valorant" },
  { process: "cs2.exe", label: "Jogando Counter-Strike 2" },
  { process: "FortniteClient-Win64-Shipping.exe", label: "Jogando Fortnite" },
  { process: "Minecraft.Windows.exe", label: "Jogando Minecraft" },
  { process: "javaw.exe", label: "Jogando Minecraft" },
  { process: "RocketLeague.exe", label: "Jogando Rocket League" },
  { process: "GTA5.exe", label: "Jogando GTA V" },
  { process: "Dota2.exe", label: "Jogando Dota 2" },
  { process: "eldenring.exe", label: "Jogando Elden Ring" },
  { process: "stardew valley.exe", label: "Jogando Stardew Valley" },
  { process: "Terraria.exe", label: "Jogando Terraria" },
  { process: "steam.exe", label: "Na Steam" },
  { process: "Code.exe", label: "Programando no VS Code" },
  { process: "Cursor.exe", label: "Programando no Cursor" },
  { process: "spotify.exe", label: "Ouvindo Spotify" },
  { process: "chrome.exe", label: "No navegador" },
  { process: "msedge.exe", label: "No navegador" },
  { process: "firefox.exe", label: "No navegador" },
];

/** Manual override wins over detection — set from the custom status UI. */
let manualActivity: UserActivity | null = null;

export function setManualActivity(activity: UserActivity | null) {
  manualActivity = activity;
}

/** Process sniffing is opt-out: on unless the user disabled it in settings. */
export function readActivityDetectEnabled(): boolean {
  return localStorage.getItem(DETECT_KEY) !== "false";
}

export function writeActivityDetectEnabled(enabled: boolean): boolean {
  localStorage.setItem(DETECT_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("molezinha:activity-detect", { detail: enabled }));
  return enabled;
}

export function activityLabel(activity: UserActivity | null | undefined): string | null {
  if (!activity) return null;
  const name = activity.name?.trim();
  if (!name) return null;
  const details = activity.details?.trim();
  return details ? `${name} — ${details}` : name;
}

async function detectActivity(): Promise<UserActivity | null> {
  if (manualActivity) return manualActivity;
  if (!isTauri() || !readActivityDetectEnabled()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const hint = await invoke<string | null>("get_activity_hint", {
      candidates: ACTIVITY_RULES.map((r) => r.process),
    });
    if (!hint) return null;
    const rule = ACTIVITY_RULES.find(
      (r) => r.process.toLowerCase() === hint.toLowerCase()
    );
    if (!rule) return null;
    return { name: rule.label, started_at: new Date().toISOString() };
  } catch (err) {
    console.warn("[activity] detection failed", err);
    return null;
  }
}

function sameActivity(a: UserActivity | null, b: UserActivity | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.name === b.name && (a.details ?? null) === (b.details ?? null);
}

/**
 * Polls the current activity and writes it to `profiles.activity` whenever it
 * changes. Returns a cleanup function.
 */
export function startActivityTracking(userId: string): () => void {
  let current: UserActivity | null = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    const next = await detectActivity();
    if (stopped || sameActivity(current, next)) return;
    // Keep the original start time while the same activity continues.
    current = next;
    const { error } = await supabase
      .from("profiles")
      .update({ activity: next })
      .eq("id", userId);
    if (error) console.warn("[activity] update failed", error.message);
  };

  void tick();
  const timer = window.setInterval(() => void tick(), POLL_MS);
  // Toggling detection off should clear the activity right away, not in 30s.
  const onToggle = () => void tick();
  window.addEventListener("molezinha:activity-detect", onToggle);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("molezinha:activity-detect", onToggle);
    if (current) {
      void supabase.from("profiles").update({ activity: null }).eq("id", userId);
    }
  };
}
