import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile, ThemePreference, ThemeSettings } from "@molezinha/shared";
import { supabase } from "./supabase";
import {
  applyAppearance,
  emptyThemeSettings,
  readStoredThemeSettings,
  resolveThemeMode,
} from "./theme";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<Profile | null>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    username: string,
    displayName: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  theme: ThemePreference;
  themeSettings: ThemeSettings;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setThemeSettings: (settings: ThemeSettings) => Promise<void>;
  setAppearance: (theme: ThemePreference, settings: ThemeSettings) => Promise<void>;
  resolvedTheme: "light" | "dark";
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    return (localStorage.getItem("molezinha.theme") as ThemePreference) || "dark";
  });
  const [themeSettings, setThemeSettingsState] = useState<ThemeSettings>(() =>
    readStoredThemeSettings()
  );
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    resolveThemeMode(
      (localStorage.getItem("molezinha.theme") as ThemePreference) || "dark"
    )
  );
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushAppearance = useCallback((nextTheme: ThemePreference, nextSettings: ThemeSettings) => {
    setResolvedTheme(applyAppearance(nextTheme, nextSettings));
  }, []);

  const scheduleSync = useCallback(
    (nextTheme: ThemePreference, nextSettings: ThemeSettings) => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        void (async () => {
          const userId = (await supabase.auth.getUser()).data.user?.id;
          if (!userId) return;
          await supabase
            .from("profiles")
            .update({ theme: nextTheme, theme_settings: nextSettings })
            .eq("id", userId);
        })();
      }, 400);
    },
    []
  );

  const refreshProfile = useCallback(async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (data) {
      const p = data as Profile;
      setProfile(p);
      if (p.theme) {
        const settings = (p.theme_settings as ThemeSettings) ?? {};
        setThemeState(p.theme);
        setThemeSettingsState(settings);
        pushAppearance(p.theme, settings);
      }
    }
  }, [pushAppearance]);

  useEffect(() => {
    pushAppearance(theme, themeSettings);
  }, [theme, themeSettings, pushAppearance]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => pushAppearance("system", themeSettings);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, themeSettings, pushAppearance]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, []);

  useEffect(() => {
    if (session?.user) {
      void refreshProfile();
      // Only mark online when coming back from offline — never clobber dnd/idle/in_call.
      void (async () => {
        const { data } = await supabase
          .from("profiles")
          .select("status")
          .eq("id", session.user.id)
          .maybeSingle();
        const current = (data as { status?: string } | null)?.status;
        if (!current || current === "offline") {
          await supabase
            .from("profiles")
            .update({ status: "online" })
            .eq("id", session.user.id);
        }
      })();
    } else {
      setProfile(null);
    }
  }, [session, refreshProfile]);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return null;
    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .select("*")
      .single();
    if (error) throw error;
    const next = data as Profile;
    setProfile(next);
    return next;
  }, []);

  /** Single entry point so mode and settings never sync out of step. */
  const setAppearance = useCallback(
    async (nextTheme: ThemePreference, nextSettings: ThemeSettings) => {
      setThemeState(nextTheme);
      setThemeSettingsState(nextSettings);
      pushAppearance(nextTheme, nextSettings);
      scheduleSync(nextTheme, nextSettings);
    },
    [pushAppearance, scheduleSync]
  );

  const setTheme = useCallback(
    (next: ThemePreference) => setAppearance(next, themeSettings),
    [themeSettings, setAppearance]
  );

  const setThemeSettings = useCallback(
    (next: ThemeSettings) => setAppearance(theme, next),
    [theme, setAppearance]
  );

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      refreshProfile,
      updateProfile,
      theme,
      themeSettings,
      setTheme,
      setThemeSettings,
      setAppearance,
      resolvedTheme,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      },
      async signUp(email, password, username, displayName) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username, display_name: displayName },
          },
        });
        if (error) throw error;
      },
      async signOut() {
        if (session?.user) {
          await supabase
            .from("profiles")
            .update({ status: "offline", voice_channel_id: null })
            .eq("id", session.user.id);
        }
        await supabase.auth.signOut();
      },
    }),
    [
      session,
      profile,
      loading,
      refreshProfile,
      updateProfile,
      theme,
      themeSettings,
      setTheme,
      setThemeSettings,
      setAppearance,
      resolvedTheme,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

export { emptyThemeSettings };
