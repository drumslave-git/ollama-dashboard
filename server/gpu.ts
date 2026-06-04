import { envNumber } from "./env.js";

export interface GpuStats {
  totalVram: number | null;
  usedVram: number | null;
  freeVram: number | null;
  usedByModels: number;
  configured: boolean;
  note?: string;
}

async function fetchUsedByModels(ollamaHost: string): Promise<number> {
  const res = await fetch(`${ollamaHost}/api/ps`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return 0;
  const data = (await res.json()) as { models?: { size_vram?: number }[] };
  return (data.models ?? []).reduce((sum, m) => sum + (m.size_vram ?? 0), 0);
}

export async function getGpuStats(ollamaHost: string): Promise<GpuStats> {
  const usedByModels = await fetchUsedByModels(ollamaHost);
  const totalGb = envNumber("GPU_VRAM_TOTAL_GB", 0);

  if (totalGb > 0) {
    const total = totalGb * 1024 ** 3;
    const used = usedByModels;
    const free = Math.max(0, total - used);
    return {
      totalVram: total,
      usedVram: used,
      freeVram: free,
      usedByModels,
      configured: true,
    };
  }

  return {
    totalVram: null,
    usedVram: usedByModels > 0 ? usedByModels : null,
    freeVram: null,
    usedByModels,
    configured: false,
    note: "Set GPU_VRAM_TOTAL_GB in .env to show VRAM usage percentage.",
  };
}
