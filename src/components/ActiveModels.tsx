import { useCallback, useState } from "react";
import { pinModel, unloadModel } from "../api/ollama";
import type { RunningModel } from "../types/ollama";
import { formatBytes, formatRelativeTime, vramUsedPercent } from "../lib/format";
import { VramBar } from "./VramBar";

interface Props {
  models: RunningModel[];
  totalVram: number | null;
  onRefresh: () => void;
}

function isModelPinned(model: RunningModel): boolean {
  return !model.expires_at;
}

export function ActiveModels({ models, totalVram, onRefresh }: Props) {
  const [unloading, setUnloading] = useState<string | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);

  const runUnload = useCallback(
    async (name: string) => {
      setUnloading(name);
      try {
        await unloadModel(name);
        onRefresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Unload failed");
      } finally {
        setUnloading(null);
      }
    },
    [onRefresh],
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
    return <p className="empty">No models loaded in memory.</p>;
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
        const unloadingThis = unloading === m.model;
        const pinningThis = pinning === m.model;

        return (
          <li key={m.model} className="model-item">
            <div className="model-item-header">
              <div className="name">{m.name}</div>
              <div className="model-item-actions">
                <button
                  type="button"
                  className={pinned ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                  onClick={() => void runPin(m.model)}
                  disabled={busy || pinned}
                  title={
                    pinned
                      ? "Model is pinned in memory"
                      : "Keep model loaded indefinitely (keep_alive: -1)"
                  }
                >
                  {pinningThis ? "Pinning…" : pinned ? "Pinned" : "Pin"}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => void runUnload(m.model)}
                  disabled={busy}
                >
                  {unloadingThis ? "Unloading…" : "Unload"}
                </button>
              </div>
            </div>
            <div className="meta">
              <span>Size {formatBytes(m.size)}</span>
              {onGpu ? (
                <span>
                  VRAM {formatBytes(vram)}
                  {pct != null ? ` (${pct}% of GPU)` : ""}
                </span>
              ) : (
                <span>CPU / system memory</span>
              )}
              {m.context_length != null && (
                <span>ctx {m.context_length.toLocaleString()}</span>
              )}
              {pinned ? (
                <span>pinned</span>
              ) : (
                m.expires_at && (
                  <span>expires {formatRelativeTime(m.expires_at)}</span>
                )
              )}
              {m.details?.parameter_size && (
                <span>{m.details.parameter_size}</span>
              )}
            </div>
            {pct != null && pct > 0 && (
              <VramBar percent={pct} className="bar-track model-vram-bar" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
