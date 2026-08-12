import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const tauri = isTauri();

  useEffect(() => {
    if (!tauri) return;
    const win = getCurrentWindow();
    void win.isMaximized().then(setMaximized);
    let unlisten: (() => void) | undefined;
    void win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [tauri]);

  async function minimize() {
    if (!tauri) return;
    await getCurrentWindow().minimize();
  }

  async function toggleMax() {
    if (!tauri) return;
    await getCurrentWindow().toggleMaximize();
    setMaximized(await getCurrentWindow().isMaximized());
  }

  async function close() {
    if (!tauri) return;
    await getCurrentWindow().close();
  }

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <span className="titlebar-mark" data-tauri-drag-region>
          M
        </span>
        <span className="titlebar-name" data-tauri-drag-region>
          molezinha
        </span>
      </div>
      {tauri && (
        <div className="titlebar-controls">
          <button type="button" className="titlebar-btn" onClick={() => void minimize()} aria-label="Minimizar">
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
              <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="titlebar-btn" onClick={() => void toggleMax()} aria-label={maximized ? "Restaurar" : "Maximizar"}>
            {maximized ? (
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                <path d="M3.5 4.5h5v5h-5zM4.5 3.5h5v5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            ) : (
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>
          <button type="button" className="titlebar-btn titlebar-btn-close" onClick={() => void close()} aria-label="Fechar">
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
}
