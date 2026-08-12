import { StrictMode, Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./lib/auth";
import { hasSupabaseConfig, supabaseConfigError } from "./lib/supabase";
import { BootError } from "./components/BootError";
import App from "./App";
import "@fontsource-variable/syne";
import "@fontsource-variable/figtree";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[molezinha] render crash", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <BootError
          title="Algo quebrou ao abrir o app"
          message={this.state.error.message || "Erro inesperado na interface."}
        />
      );
    }
    return this.props.children;
  }
}

const root = createRoot(document.getElementById("root")!);

if (!hasSupabaseConfig) {
  root.render(
    <BootError
      title="Configuração ausente"
      message={supabaseConfigError ?? "Variáveis do Supabase não encontradas neste build."}
    />
  );
} else {
  root.render(
    <StrictMode>
      <RootErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </RootErrorBoundary>
    </StrictMode>
  );
}
