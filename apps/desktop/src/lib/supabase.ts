import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || "";
const key =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || "";

/** True when the production/dev build has the client credentials baked in. */
export const hasSupabaseConfig = Boolean(url && key);

export const supabaseConfigError = hasSupabaseConfig
  ? null
  : "Build sem VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Reinstale a partir de um release gerado com essas variáveis.";

if (!hasSupabaseConfig) {
  console.error("[molezinha]", supabaseConfigError);
}

/**
 * Lazily constructed so a missing env does not crash the whole window to a
 * black screen before React can render an error state.
 */
export const supabase: SupabaseClient = hasSupabaseConfig
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : (new Proxy({} as SupabaseClient, {
      get() {
        throw new Error(supabaseConfigError ?? "Supabase não configurado");
      },
    }) as SupabaseClient);

export const CALLS_URL =
  (import.meta.env.VITE_CALLS_URL as string) || "ws://127.0.0.1:3001/ws";
