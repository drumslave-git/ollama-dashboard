export interface GpuStats {
  totalVram: number | null;
  usedVram: number | null;
  freeVram: number | null;
  usedByModels: number;
  configured: boolean;
  note?: string;
}
