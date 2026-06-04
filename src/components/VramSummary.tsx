import type { GpuStats } from "../types/gpu";
import type { RunningModel } from "../types/ollama";
import { formatBytes, vramUsedPercent } from "../lib/format";
import { VramBar } from "./VramBar";

interface Props {
  models: RunningModel[];
  gpu: GpuStats | null;
  gpuError: string | null;
  gpuLoading: boolean;
}

export function VramSummary({ models, gpu, gpuError, gpuLoading }: Props) {
  const total = gpu?.totalVram ?? null;
  const used = gpu?.usedVram ?? gpu?.usedByModels ?? 0;
  const free = gpu?.freeVram ?? null;
  const usedPct = total != null ? vramUsedPercent(used, total) : 0;

  if (gpuLoading && !gpu) {
    return <p className="empty">Loading GPU memory…</p>;
  }

  if (gpuError) {
    return <p className="empty">{gpuError}</p>;
  }

  return (
    <div className="vram-total">
      {total != null && total > 0 ? (
        <>
          <div className="label">
            <span>VRAM used</span>
            <span className="value">{usedPct}%</span>
          </div>
          <VramBar percent={usedPct} />
          <div className="vram-stats">
            <span>
              {formatBytes(used)} / {formatBytes(total)}
            </span>
            {free != null && <span>Available {formatBytes(free)}</span>}
          </div>
        </>
      ) : (
        <>
          <div className="label">
            <span>VRAM in loaded models</span>
            <span className="value">{used > 0 ? formatBytes(used) : "—"}</span>
          </div>
          {gpu?.note && <p className="vram-note">{gpu.note}</p>}
        </>
      )}

      {models.length === 0 && total == null && !gpu?.note && (
        <p className="empty" style={{ marginTop: "0.75rem" }}>
          Load a model to see VRAM usage.
        </p>
      )}
    </div>
  );
}
