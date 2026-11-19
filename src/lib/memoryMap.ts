import type { RunningModel } from "../types/ollama";

const GiB = 1024 ** 3;

/** Model colors in the VRAM memory map, as theme tokens. The largest model takes the accent. */
const SERIES = [1, 2, 3, 4, 5].map((n) => `var(--series-${n})`);

/** Block size that draws the GPU in at most 64 blocks (24 GB → 0.5 GB blocks). */
export function memoryBlockSize(total: number): number {
  const steps = [0.25, 0.5, 1, 2, 4, 8].map((g) => g * GiB);
  return steps.find((s) => total / s <= 64) ?? steps[steps.length - 1];
}

/** GPU-resident models, largest first, each with its map color. */
export function modelColors(models: RunningModel[]): Map<string, string> {
  const colors = new Map<string, string>();
  [...models]
    .filter((m) => (m.size_vram ?? 0) > 0)
    .sort((a, b) => (b.size_vram ?? 0) - (a.size_vram ?? 0))
    .forEach((m, i) => colors.set(m.model, SERIES[i % SERIES.length]));
  return colors;
}

export interface MemoryBlock {
  model: string | null;
  color: string | null;
}

/** Lay out loaded models as runs of blocks over the whole GPU. */
export function memoryBlocks(
  models: RunningModel[],
  total: number,
  colors: Map<string, string>,
): { blocks: MemoryBlock[]; blockSize: number } {
  const blockSize = memoryBlockSize(total);
  const count = Math.ceil(total / blockSize);
  const blocks: MemoryBlock[] = Array.from({ length: count }, () => ({
    model: null,
    color: null,
  }));

  const ordered = [...models]
    .filter((m) => (m.size_vram ?? 0) > 0)
    .sort((a, b) => (b.size_vram ?? 0) - (a.size_vram ?? 0));

  let used = 0;
  let cursor = 0;
  for (const m of ordered) {
    used += m.size_vram ?? 0;
    const end = Math.min(count, Math.max(cursor + 1, Math.round(used / blockSize)));
    for (let i = cursor; i < end; i++) {
      blocks[i] = { model: m.model, color: colors.get(m.model) ?? null };
    }
    cursor = end;
  }

  return { blocks, blockSize };
}
