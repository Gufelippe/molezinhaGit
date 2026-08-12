import { useEffect, useState } from "react";
import type { MusicChannelState } from "@molezinha/shared";
import { callClient } from "../lib/calls";
import { musicApi } from "../lib/musicApi";
import { IconMusic } from "./Icons";
import { NeoRange } from "./NeoControls";

type Props = {
  channelId: string;
  userId: string;
  isStaff: boolean;
};

export function MusicPanel({ channelId, userId, isStaff }: Props) {
  const [state, setState] = useState<MusicChannelState | null>(() => callClient.getMusicState());
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(() => Math.round(callClient.getMusicVolume() * 100));

  useEffect(() => callClient.onMusicState(setState), []);

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na música");
    } finally {
      setBusy(false);
    }
  }

  const now = state?.nowPlaying ?? null;
  const queue = state?.queue ?? [];
  const canControlNow =
    Boolean(now) && (isStaff || now?.requestedBy === userId);

  return (
    <div className="music-panel">
      <div className="music-panel-head">
        <IconMusic />
        <strong>Música</strong>
      </div>

      <form
        className="music-panel-form"
        onSubmit={(e) => {
          e.preventDefault();
          const next = url.trim();
          if (!next) return;
          void run(async () => {
            await musicApi.play(channelId, next);
            setUrl("");
          });
        }}
      >
        <input
          className="neo-input"
          value={url}
          placeholder="Cole o link do YouTube"
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className="neo-btn neo-btn-compact neo-btn-primary" type="submit" disabled={busy || !url.trim()}>
          Enfileirar
        </button>
      </form>

      {now ? (
        <div className="music-now">
          {now.thumbnail && <img className="music-thumb" src={now.thumbnail} alt="" />}
          <div className="music-now-copy">
            <span className="music-now-label">Tocando</span>
            <strong className="music-now-title">{now.title}</strong>
            <span className="muted music-now-by">pediu {now.requestedByName}</span>
          </div>
          <div className="music-now-actions">
            {canControlNow && (
              <>
                <button
                  type="button"
                  className="neo-btn neo-btn-tiny"
                  disabled={busy}
                  onClick={() => void run(() => musicApi.skip(channelId))}
                >
                  Pular
                </button>
                <button
                  type="button"
                  className="neo-btn neo-btn-tiny neo-btn-danger"
                  disabled={busy}
                  onClick={() => void run(() => musicApi.stop(channelId))}
                >
                  Parar
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="muted music-empty">Nada tocando — cole um link pra começar.</p>
      )}

      {queue.length > 0 && (
        <ul className="music-queue">
          {queue.map((track, i) => {
            const canRemove = isStaff || track.requestedBy === userId;
            return (
              <li key={track.trackId} className="music-queue-item">
                <span className="music-queue-pos">{i + 1}</span>
                <div className="music-queue-copy">
                  <strong>{track.title}</strong>
                  <span className="muted">{track.requestedByName}</span>
                </div>
                {canRemove && (
                  <button
                    type="button"
                    className="neo-btn neo-btn-tiny"
                    disabled={busy}
                    onClick={() => void run(() => musicApi.remove(channelId, track.trackId))}
                  >
                    Remover
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="music-volume">
        <label htmlFor="music-volume">Volume da música ({volume}%)</label>
        <NeoRange
          id="music-volume"
          min={0}
          max={100}
          step={5}
          value={volume}
          aria-label="Volume da música"
          onChange={(v) => {
            setVolume(v);
            callClient.setMusicVolume(v / 100);
          }}
        />
      </div>

      {error && <p className="music-error">{error}</p>}
    </div>
  );
}
