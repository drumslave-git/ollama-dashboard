import { useCallback, useState } from "react";
import { pinModel, unloadModel } from "../api/ollama";
import type { RunningModel } from "../types/ollama";
import { formatBytes, formatRelativeTime, vramUsedPercent } from "../lib/format";

interface Props {
  models: RunningModel[];
  totalVram: number | null;
  colors: Map<string, string>;
  onFocusModel: (model: string | null) => void;
  onRefresh: () => void;
}

function isModelPinned(model: RunningModel): boolean {
  return !model.expires_at;
}

export function ActiveModels({
  models,
  totalVram,
  colors,
  onFocusModel,
  onRefresh,
}: Props) {
  const [unloading, setUnloading] = useState<string | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);

  const runUnload = useCallback(
    async (name: string) => {
      setUnloading(name);
      try {
        await unloadModel(name);
        onFocusModel(null);
        onRefresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Unload failed");
      } finally {
        setUnloading(null);
      }
    },
    [onFocusModel, onRefresh],
  );

  const runPin = useCallback(
    async (name: string) => {
      setPinning(name);
      try {
        await pinModel(name);
        onRefresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Pin failed");
      } finally {
        setPinning(null);
      }
    },
    [onRefresh],
  );

  if (models.length === 0) {
    return <p className="empty">No models in memory</p>;
  }

  return (
    <ul className="model-list">
      {models.map((m) => {
        const vram = m.size_vram ?? 0;
        const onGpu = vram > 0;
        const pct =
          onGpu && totalVram != null && totalVram > 0
            ? vramUsedPercent(vram, totalVram)
            : null;

        const pinned = isModelPinned(m);
        const busy = unloading !== null || pinning !== null;
        const color = colors.get(m.model);

        return (
          <li
            key={m.model}
            className="model-item"
            onMouseEnter={() => onGpu && onFocusModel(m.model)}
            onMouseLeave={() => onFocusModel(null)}
          >
            <div className="model-item-header">
              <span
                className={onGpu ? "model-chip" : "model-chip cpu"}
                style={color ? { background: color } : undefined}
                aria-hidden
              />
              <div className="model-name" title={m.name}>
                {m.name}
              </div>
              <div className="model-item-actions">
                {!pinned && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => void runPin(m.model)}
                    disabled={busy}
                    title="Keep model loaded indefinitely (keep_alive: -1)"
                  >
                    {pinning === m.model ? "Pinning…" : "Pin"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => void runUnload(m.model)}
                  disabled={busy}
                >
                  {unloading === m.model ? "Unloading…" : "Unload"}
                </button>
              </div>
            </div>
            <dl className="model-meta">
              {onGpu ? (
                <div>
                  <dt>VRAM</dt>
                  <dd>
                    {formatBytes(vram)}
                    {pct != null ? ` · ${pct}%` : ""}
                  </dd>
                </div>
              ) : (
                <div>
                  <dt>Memory</dt>
                  <dd>{formatBytes(m.size)} in system RAM</dd>
                </div>
              )}
              {m.context_length != null && (
                <div>
                  <dt>Context</dt>
                  <dd>{m.context_length.toLocaleString()}</dd>
                </div>
              )}
              {m.details?.parameter_size && (
                <div>
                  <dt>Params</dt>
                  <dd>{m.details.parameter_size}</dd>
                </div>
              )}
              {(pinned || m.expires_at) && (
                <div>
                  <dt>Unloads</dt>
                  <dd>
                    {pinned || !m.expires_at
                      ? "never, pinned"
                      : formatRelativeTime(m.expires_at)}
                  </dd>
                </div>
              )}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
