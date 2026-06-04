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
