import { useCallback, useState } from "react";
import { unloadModel } from "../api/ollama";
import type { RunningModel } from "../types/ollama";
import { formatBytes, formatRelativeTime, vramUsedPercent } from "../lib/format";
import { VramBar } from "./VramBar";

interface Props {
  models: RunningModel[];
  totalVram: number | null;
  onRefresh: () => void;
}

export function ActiveModels({ models, totalVram, onRefresh }: Props) {
  const [unloading, setUnloading] = useState<string | null>(null);

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

        const busy = unloading === m.model;

        return (
          <li key={m.model} className="model-item">
            <div className="model-item-header">
              <div className="name">{m.name}</div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => void runUnload(m.model)}
                disabled={unloading !== null}
              >
                {busy ? "Unloading…" : "Unload"}
              </button>
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
              {m.expires_at && (
                <span>expires {formatRelativeTime(m.expires_at)}</span>
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
