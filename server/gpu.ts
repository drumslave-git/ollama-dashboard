import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { envNumber } from "./env.js";

const execFileAsync = promisify(execFile);

export interface GpuDevice {
  name: string;
  total: number;
  used: number;
  free: number;
}

export interface GpuStats {
  devices: GpuDevice[];
  totalVram: number | null;
  usedVram: number | null;
  freeVram: number | null;
  usedByModels: number;
  source: "ollama-info" | "nvidia-smi" | "env" | "models-only";
  note?: string;
}

function sumDevices(devices: GpuDevice[]): Pick<GpuStats, "totalVram" | "usedVram" | "freeVram"> {
  if (devices.length === 0) {
    return { totalVram: null, usedVram: null, freeVram: null };
  }
  return {
    totalVram: devices.reduce((s, d) => s + d.total, 0),
    usedVram: devices.reduce((s, d) => s + d.used, 0),
    freeVram: devices.reduce((s, d) => s + d.free, 0),
  };
}

async function fetchUsedByModels(ollamaHost: string): Promise<number> {
  const res = await fetch(`${ollamaHost}/api/ps`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return 0;
  const data = (await res.json()) as { models?: { size_vram?: number }[] };
  return (data.models ?? []).reduce((sum, m) => sum + (m.size_vram ?? 0), 0);
}

/** Ollama /api/info (when available) — see ollama/ollama#7262 */
async function fetchOllamaInfo(ollamaHost: string): Promise<GpuDevice[] | null> {
  const res = await fetch(`${ollamaHost}/api/info`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    compute?: {
      supported_gpus?: Record<
        string,
        {
          name?: string;
          total_memory?: number;
          free_memory?: number;
        }
      >;
    };
  };

  const gpus = data.compute?.supported_gpus;
  if (!gpus) return null;

  const devices: GpuDevice[] = [];
  for (const gpu of Object.values(gpus)) {
    const total = gpu.total_memory ?? 0;
    const free = gpu.free_memory ?? 0;
    if (total <= 0) continue;
    devices.push({
      name: gpu.name ?? "GPU",
      total,
      free,
      used: Math.max(0, total - free),
    });
  }
  return devices.length > 0 ? devices : null;
}

async function fetchNvidiaSmi(): Promise<GpuDevice[] | null> {
  if (process.env.GPU_STATS === "off") return null;

  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=name,memory.total,memory.used,memory.free",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 5000, windowsHide: true },
    );

    const devices: GpuDevice[] = [];
    for (const line of stdout.trim().split("\n")) {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length < 4) continue;
      const [name, totalMiB, usedMiB, freeMiB] = parts;
      const total = Number(totalMiB) * 1024 * 1024;
      const used = Number(usedMiB) * 1024 * 1024;
      const free = Number(freeMiB) * 1024 * 1024;
      if (!Number.isFinite(total)) continue;
      devices.push({ name, total, used, free });
    }
    return devices.length > 0 ? devices : null;
  } catch {
    return null;
  }
}

function envTotalVram(): number | null {
  const bytes = process.env.GPU_VRAM_TOTAL_BYTES;
  if (bytes) {
    const n = Number(bytes);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const gb = envNumber("GPU_VRAM_TOTAL_GB", 0);
  if (gb > 0) return gb * 1024 ** 3;
  return null;
}

function isLocalOllama(host: string): boolean {
  try {
    const { hostname } = new URL(host);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export async function getGpuStats(ollamaHost: string): Promise<GpuStats> {
  const usedByModels = await fetchUsedByModels(ollamaHost);

  const fromInfo = await fetchOllamaInfo(ollamaHost);
  if (fromInfo) {
    const totals = sumDevices(fromInfo);
    return {
      devices: fromInfo,
      ...totals,
      usedByModels,
      source: "ollama-info",
    };
  }

  const useSmi =
    process.env.GPU_STATS === "nvidia-smi" ||
    (process.env.GPU_STATS !== "off" && isLocalOllama(ollamaHost));
  if (useSmi) {
    const fromSmi = await fetchNvidiaSmi();
    if (fromSmi) {
      const totals = sumDevices(fromSmi);
      return {
        devices: fromSmi,
        ...totals,
        usedByModels,
        source: "nvidia-smi",
      };
    }
  }

  const envTotal = envTotalVram();
  if (envTotal) {
    const used = usedByModels > 0 ? usedByModels : 0;
    const free = Math.max(0, envTotal - used);
    return {
      devices: [
        {
          name: "GPU (configured)",
          total: envTotal,
          used,
          free,
        },
      ],
      totalVram: envTotal,
      usedVram: used,
      freeVram: free,
      usedByModels,
      source: "env",
      note: "Totals from GPU_VRAM_TOTAL_GB; used reflects loaded models.",
    };
  }

  return {
    devices: [],
    totalVram: null,
    usedVram: usedByModels > 0 ? usedByModels : null,
    freeVram: null,
    usedByModels,
    source: "models-only",
    note:
      "Available VRAM needs Ollama /api/info, nvidia-smi (local), or GPU_VRAM_TOTAL_GB in .env.",
  };
}
