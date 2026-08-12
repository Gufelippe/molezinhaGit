interface BootErrorProps {
  title: string;
  message: string;
}

/** Full-window fallback when the app cannot start (e.g. missing build env). */
export function BootError({ title, message }: BootErrorProps) {
  return (
    <div className="app-root">
      <div className="app-root-body splash">
        <div className="splash-inner boot-error">
          <span className="brand-pulse">molezinha</span>
          <h1 className="boot-error-title">{title}</h1>
          <p className="muted boot-error-msg">{message}</p>
        </div>
      </div>
    </div>
  );
}
