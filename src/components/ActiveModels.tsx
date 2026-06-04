import type { RunningModel } from "../types/ollama";
import { formatBytes, formatRelativeTime, vramUsedPercent } from "../lib/format";
import { VramBar } from "./VramBar";

interface Props {
  models: RunningModel[];
  totalVram: number | null;
}

export function ActiveModels({ models, totalVram }: Props) {
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

        return (
          <li key={m.model} className="model-item">
            <div className="name">{m.name}</div>
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
