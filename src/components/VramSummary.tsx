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

const SOURCE_LABEL: Record<GpuStats["source"], string> = {
  "ollama-info": "Ollama",
  "nvidia-smi": "nvidia-smi",
  env: ".env",
  "models-only": "loaded models",
};

export function VramSummary({ models, gpu, gpuError, gpuLoading }: Props) {
  const total = gpu?.totalVram ?? null;
  const used =
    total != null
      ? (gpu?.usedVram ?? gpu?.usedByModels ?? 0)
      : (gpu?.usedByModels ?? 0);
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
            {gpu && (
              <span className="vram-source">via {SOURCE_LABEL[gpu.source]}</span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="label">
            <span>VRAM in loaded models</span>
            <span className="value">
              {used > 0 ? formatBytes(used) : "—"}
            </span>
          </div>
          {gpu?.note && <p className="vram-note">{gpu.note}</p>}
        </>
      )}

      {gpu && gpu.devices.length > 1 && (
        <ul className="gpu-device-list">
          {gpu.devices.map((d) => (
            <li key={d.name}>
              <span className="gpu-name">{d.name}</span>
              <span>
                {vramUsedPercent(d.used, d.total)}% used ({formatBytes(d.used)} /{" "}
                {formatBytes(d.total)})
              </span>
            </li>
          ))}
        </ul>
      )}

      {models.length === 0 && total == null && !gpu?.note && (
        <p className="empty" style={{ marginTop: "0.75rem" }}>
          Load a model to see VRAM usage.
        </p>
      )}
    </div>
  );
}
