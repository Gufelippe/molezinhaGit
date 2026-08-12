import type { ThemeColorKey, ThemePreference, ThemeSettings } from "@molezinha/shared";

export const THEME_COLOR_KEYS: { key: ThemeColorKey; label: string }[] = [
  { key: "bg", label: "Fundo" },
  { key: "bgDeep", label: "Fundo profundo" },
  { key: "bgElevated", label: "Elevado" },
  { key: "surface", label: "Superfície" },
  { key: "text", label: "Texto" },
  { key: "textMuted", label: "Texto suave" },
  { key: "accent", label: "Accent" },
  { key: "accentBright", label: "Accent claro" },
  { key: "accentSoft", label: "Accent suave" },
  { key: "danger", label: "Perigo" },
  { key: "dangerSoft", label: "Perigo suave" },
  { key: "success", label: "Sucesso" },
  { key: "shadowLight", label: "Sombra clara" },
  { key: "shadowDark", label: "Sombra escura" },
];

export const THEME_FONTS = [
  { id: "Syne", stack: '"Syne Variable", "Syne", system-ui, sans-serif', label: "Syne", google: "Syne:wght@600;700;800" },
  { id: "Figtree", stack: '"Figtree Variable", "Figtree", system-ui, sans-serif', label: "Figtree", google: "Figtree:wght@400;500;600;700" },
  { id: "Outfit", stack: '"Outfit", "Syne Variable", system-ui, sans-serif', label: "Outfit", google: "Outfit:wght@500;600;700" },
  { id: "Source Sans 3", stack: '"Source Sans 3", "Figtree Variable", system-ui, sans-serif', label: "Source Sans 3", google: "Source+Sans+3:wght@400;600;700" },
  { id: "Fraunces", stack: '"Fraunces", Georgia, serif', label: "Fraunces", google: "Fraunces:opsz,wght@9..144,600;700" },
  { id: "JetBrains Mono", stack: 'var(--font-mono)', label: "JetBrains Mono", google: "JetBrains+Mono:wght@500;600" },
] as const;

/** Bundled locally through @fontsource-variable imports in main.tsx. */
const loadedFontIds = new Set<string>(["Syne", "Figtree", "JetBrains Mono"]);

/** Lazy-load the optional theme fonts that are not bundled with the app. */
export function ensureThemeFonts(...ids: Array<string | null | undefined>) {
  const needed = ids.filter(
    (id): id is string => typeof id === "string" && id.length > 0 && !loadedFontIds.has(id)
  );
  if (!needed.length) return;
  const families = THEME_FONTS.filter((f) => needed.includes(f.id)).map((f) => f.google);
  if (!families.length) return;
  for (const id of needed) loadedFontIds.add(id);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap`;
  document.head.appendChild(link);
}

const CSS_VAR: Record<ThemeColorKey, string> = {
  bg: "--neo-bg",
  bgDeep: "--neo-bg-deep",
  bgElevated: "--neo-bg-elevated",
  surface: "--neo-surface",
  text: "--neo-text",
  textMuted: "--neo-text-muted",
  accent: "--neo-accent",
  accentBright: "--neo-accent-bright",
  accentSoft: "--neo-accent-soft",
  danger: "--neo-danger",
  dangerSoft: "--neo-danger-soft",
  success: "--neo-success",
  shadowLight: "--neo-shadow-light",
  shadowDark: "--neo-shadow-dark",
};

export const LIGHT_DEFAULTS: Record<ThemeColorKey, string> = {
  bg: "#d8dde6",
  bgDeep: "#cfd5e0",
  bgElevated: "#e4e8f0",
  surface: "#d8dde6",
  text: "#1c2433",
  textMuted: "#5c667a",
  accent: "#1f6f5b",
  accentBright: "#2a9b7c",
  accentSoft: "#b7d8cb",
  danger: "#b33a3a",
  dangerSoft: "#e8c4c4",
  success: "#2f7d4a",
  shadowLight: "#f4f6fa",
  shadowDark: "#aeb6c4",
};

export const DARK_DEFAULTS: Record<ThemeColorKey, string> = {
  bg: "#23272f",
  bgDeep: "#1a1d24",
  bgElevated: "#2c313b",
  surface: "#23272f",
  text: "#eef1f6",
  textMuted: "#939aac",
  accent: "#6fcfad",
  accentBright: "#8ee0c0",
  accentSoft: "#2d453c",
  danger: "#e07a7a",
  dangerSoft: "#4a2c2c",
  success: "#6dba86",
  shadowLight: "#30353f",
  shadowDark: "#15181d",
};

export type ThemePreset = {
  id: string;
  label: string;
  mode: "light" | "dark";
  settings: ThemeSettings;
  swatch: string;
};

function preset(
  id: string,
  label: string,
  mode: "light" | "dark",
  colors: Partial<Record<ThemeColorKey, string>>,
  swatch: string
): ThemePreset {
  return {
    id,
    label,
    mode,
    swatch,
    settings: {
      presetId: id,
      colors: { ...(mode === "dark" ? DARK_DEFAULTS : LIGHT_DEFAULTS), ...colors },
      radiusPx: 22,
      fontDisplay: "Syne",
      fontBody: "Figtree",
    },
  };
}

export const THEME_PRESETS: ThemePreset[] = [
  preset(
    "molezinha-dark",
    "Molezinha",
    "dark",
    {
      bg: "#1e2624",
      bgDeep: "#151b1a",
      bgElevated: "#2a3330",
      surface: "#1e2624",
      text: "#eef4f1",
      textMuted: "#8fa39a",
      accent: "#5fbf9a",
      accentBright: "#7fd4b2",
      accentSoft: "#2a443c",
      shadowLight: "#2c3633",
      shadowDark: "#0e1211",
    },
    "linear-gradient(145deg,#2a3330,#151b1a)"
  ),
  preset(
    "molezinha-light",
    "Molezinha clara",
    "light",
    {
      bg: "#d9e2dd",
      bgDeep: "#c8d4cd",
      bgElevated: "#e8efea",
      surface: "#d9e2dd",
      text: "#1a2420",
      textMuted: "#5a6b63",
      accent: "#1f6f5b",
      accentBright: "#2a9b7c",
      accentSoft: "#b7d8cb",
      shadowLight: "#f0f5f2",
      shadowDark: "#a8b5ae",
    },
    "linear-gradient(145deg,#e8efea,#c8d4cd)"
  ),
  preset("midnight", "Midnight", "dark", {}, "linear-gradient(145deg,#2a2e36,#1a1d24)"),
  preset("porcelain", "Porcelain", "light", {}, "linear-gradient(145deg,#eef1f5,#d0d5df)"),
  preset(
    "ember",
    "Ember",
    "dark",
    {
      bg: "#2a221c",
      bgDeep: "#1c1612",
      bgElevated: "#3a2e26",
      surface: "#2a221c",
      accent: "#e09a4a",
      accentBright: "#f0b56a",
      accentSoft: "#4a3520",
      shadowLight: "#3a3028",
      shadowDark: "#120e0c",
    },
    "linear-gradient(145deg,#3a2e26,#1c1612)"
  ),
  preset(
    "ocean",
    "Ocean",
    "dark",
    {
      bg: "#1c2733",
      bgDeep: "#121a24",
      bgElevated: "#273646",
      surface: "#1c2733",
      accent: "#4aa8d8",
      accentBright: "#6bc0ea",
      accentSoft: "#1e3a4a",
      shadowLight: "#2a3848",
      shadowDark: "#0c1218",
    },
    "linear-gradient(145deg,#273646,#121a24)"
  ),
  preset(
    "graphite",
    "Graphite",
    "dark",
    {
      bg: "#2a2a2a",
      bgDeep: "#181818",
      bgElevated: "#3a3a3a",
      surface: "#2a2a2a",
      text: "#f2f2f2",
      textMuted: "#9a9a9a",
      accent: "#d0d0d0",
      accentBright: "#efefef",
      accentSoft: "#404040",
      shadowLight: "#3a3a3a",
      shadowDark: "#101010",
    },
    "linear-gradient(145deg,#3a3a3a,#181818)"
  ),
  preset(
    "bloom",
    "Bloom",
    "light",
    {
      bg: "#efe6e2",
      bgDeep: "#e2d6d0",
      bgElevated: "#f7f0ec",
      surface: "#efe6e2",
      text: "#2a1f1c",
      textMuted: "#6e5c56",
      accent: "#c45c4a",
      accentBright: "#d97866",
      accentSoft: "#e8c4bc",
      shadowLight: "#faf6f4",
      shadowDark: "#c8b8b0",
    },
    "linear-gradient(145deg,#f7f0ec,#e2d6d0)"
  ),
];

export function resolveThemeMode(theme: ThemePreference): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function emptyThemeSettings(): ThemeSettings {
  return {};
}

export function hasThemeOverrides(settings: ThemeSettings | null | undefined): boolean {
  if (!settings) return false;
  return Boolean(
    settings.colors && Object.keys(settings.colors).length > 0 ||
      settings.radiusPx != null ||
      settings.fontDisplay ||
      settings.fontBody
  );
}

type SavedAppearance = NonNullable<ThemeSettings["saved"]>;

/** The hand-picked appearance worth parking when switching to a base mode or preset.
 *  Presets are not parked — they can always be picked again from the grid. */
export function keepCustomAppearance(
  settings: ThemeSettings | null | undefined
): SavedAppearance | undefined {
  if (!settings) return undefined;
  const { saved, ...active } = settings;
  if (!active.presetId && hasThemeOverrides(active)) return active;
  return hasThemeOverrides(saved) ? saved : undefined;
}

/** Drops every override so the plain light/dark theme shows through. */
export function baseAppearance(settings: ThemeSettings | null | undefined): ThemeSettings {
  const saved = keepCustomAppearance(settings);
  return saved ? { saved } : {};
}

/** Brings the parked custom appearance back as the active one. */
export function restoreCustomAppearance(settings: ThemeSettings): ThemeSettings {
  const saved = keepCustomAppearance(settings);
  return saved ? { ...saved } : {};
}

export function applyAppearance(theme: ThemePreference, settings: ThemeSettings = {}) {
  const resolved = resolveThemeMode(theme);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);

  for (const key of Object.keys(CSS_VAR) as ThemeColorKey[]) {
    root.style.removeProperty(CSS_VAR[key]);
  }
  root.style.removeProperty("--neo-radius");
  root.style.removeProperty("--neo-radius-sm");
  root.style.removeProperty("--neo-radius-xs");
  root.style.removeProperty("--font-display");
  root.style.removeProperty("--font-body");

  const colors = settings.colors ?? {};
  for (const [key, value] of Object.entries(colors) as [ThemeColorKey, string][]) {
    if (value && CSS_VAR[key]) root.style.setProperty(CSS_VAR[key], value);
  }

  if (typeof settings.radiusPx === "number" && Number.isFinite(settings.radiusPx)) {
    const base = Math.min(32, Math.max(8, settings.radiusPx));
    root.style.setProperty("--neo-radius", `${base}px`);
    root.style.setProperty("--neo-radius-sm", `${Math.round(base * 0.64)}px`);
    root.style.setProperty("--neo-radius-xs", `${Math.round(base * 0.45)}px`);
  }

  const display = THEME_FONTS.find((f) => f.id === settings.fontDisplay);
  const body = THEME_FONTS.find((f) => f.id === settings.fontBody);
  ensureThemeFonts(settings.fontDisplay, settings.fontBody);
  if (display) root.style.setProperty("--font-display", display.stack);
  if (body) root.style.setProperty("--font-body", body.stack);

  localStorage.setItem("molezinha.theme", theme);
  localStorage.setItem("molezinha.themeSettings", JSON.stringify(settings ?? {}));
  return resolved;
}

export function readStoredThemeSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem("molezinha.themeSettings");
    if (!raw) return {};
    return JSON.parse(raw) as ThemeSettings;
  } catch {
    return {};
  }
}
