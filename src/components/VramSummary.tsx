import type { GpuStats } from "../types/gpu";
import type { RunningModel } from "../types/ollama";
import { formatBytes, vramUsedPercent } from "../lib/format";
import { memoryBlocks } from "../lib/memoryMap";

interface Props {
  models: RunningModel[];
  colors: Map<string, string>;
  focusModel: string | null;
  gpu: GpuStats | null;
  gpuError: string | null;
  gpuLoading: boolean;
}

export function VramSummary({
  models,
  colors,
  focusModel,
  gpu,
  gpuError,
  gpuLoading,
}: Props) {
  const total = gpu?.totalVram ?? null;
  const used = gpu?.usedVram ?? gpu?.usedByModels ?? 0;
  const free = gpu?.freeVram ?? null;
  const hasTotal = total != null && total > 0;
  const usedPct = hasTotal ? vramUsedPercent(used, total) : 0;

  const header = (
    <div className="card-header">
      <h2 className="card-title">VRAM</h2>
      {hasTotal && <span className="card-meta">{usedPct}% used</span>}
    </div>
  );

  if (gpuLoading && !gpu) {
    return (
      <>
        {header}
        <p className="empty">Loading GPU memory…</p>
      </>
    );
  }

  if (gpuError) {
    return (
      <>
        {header}
        <p className="empty">{gpuError}</p>
      </>
    );
  }

  if (!hasTotal) {
    return (
      <>
        {header}
        <div className="vram-figure">
          <span className="figure">{used > 0 ? formatBytes(used) : "0 GB"}</span>
          <span className="figure-unit">in loaded models</span>
        </div>
        {gpu?.note && <p className="vram-note">{gpu.note}</p>}
      </>
    );
  }

  const { blocks, blockSize } = memoryBlocks(models, total, colors);
  const focusing =
    focusModel != null && blocks.some((b) => b.model === focusModel);

  return (
    <>
      {header}
      <div className="vram-figure">
        <span className="figure">{formatBytes(used)}</span>
        <span className="figure-unit">of {formatBytes(total)}</span>
      </div>
      <div
        className={focusing ? "memory-map has-focus" : "memory-map"}
        role="img"
        aria-label={`${formatBytes(used)} of ${formatBytes(total)} VRAM in use`}
      >
        {blocks.map((b, i) => (
          <span
            key={i}
            className={
              b.model
                ? b.model === focusModel
                  ? "block used is-focus"
                  : "block used"
                : "block"
            }
            style={b.color ? { background: b.color } : undefined}
            title={b.model ?? undefined}
          />
        ))}
      </div>
      <div className="vram-footer">
        <span>
          Free <span className="mono">{formatBytes(free ?? total - used)}</span>
        </span>
        <span>
          1 block = <span className="mono">{+(blockSize / 1024 ** 3).toFixed(2)} GB</span>
        </span>
      </div>
    </>
  );
}
