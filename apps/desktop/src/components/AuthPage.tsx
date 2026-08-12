import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";

export function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setErrorState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setError(msg: string | null) {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setErrorState(msg);
    if (msg) {
      errorTimerRef.current = setTimeout(() => {
        setErrorState(null);
        errorTimerRef.current = null;
      }, 3500);
    }
  }

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await signIn(email, password);
      } else {
        await signUp(email, password, username, displayName || username);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na autenticação");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-brand-side">
        <div className="auth-brand-mark" aria-hidden>
          M
        </div>
        <p className="auth-brand">molezinha</p>
        <p className="auth-brand-tag">
          Conversas com o pessoal, em um app leve que roda no seu computador.
        </p>
        <ul className="auth-brand-list">
          <li>Servidores, canais e DMs</li>
          <li>Chamadas de voz e vídeo</li>
          <li>Tema e cores do seu jeito</li>
        </ul>
      </aside>

      <form className="auth-card neo-outset" onSubmit={onSubmit}>
        <h1>{mode === "login" ? "Bem-vindo de volta" : "Criar sua conta"}</h1>
        <p>
          {mode === "login"
            ? "Entre para falar com o pessoal."
            : "Leva menos de um minuto para começar."}
        </p>

        {error && (
          <div className="error-banner auth-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="error-banner-dismiss"
              aria-label="Fechar"
              onClick={() => setError(null)}
            >
              ×
            </button>
          </div>
        )}

        {mode === "register" && (
          <>
            <div className="field">
              <label htmlFor="username">Usuário</label>
              <input
                id="username"
                className="neo-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                autoComplete="username"
                placeholder="seuapelido"
              />
            </div>
            <div className="field">
              <label htmlFor="displayName">Nome de exibição</label>
              <input
                id="displayName"
                className="neo-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Como vão te chamar"
              />
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="neo-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="voce@email.com"
          />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            className="neo-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="••••••••"
          />
        </div>

        <button className="neo-btn neo-btn-primary neo-btn-block" disabled={busy}>
          {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
        </button>

        <div className="auth-switch">
          <span className="muted">
            {mode === "login" ? "Não tem conta?" : "Já tem conta?"}
          </span>
          <button
            type="button"
            className="neo-btn"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Criar conta" : "Fazer login"}
          </button>
        </div>
      </form>
    </div>
  );
}
