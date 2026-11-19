export interface ModelDetails {
  parent_model?: string;
  format?: string;
  family?: string;
  families?: string[] | null;
  parameter_size?: string;
  quantization_level?: string;
  context_length?: number;
  embedding_length?: number;
}

export interface RunningModel {
  name: string;
  model: string;
  size: number;
  digest?: string;
  details?: ModelDetails;
  expires_at?: string;
  size_vram?: number;
  context_length?: number;
}

export interface LocalModel {
  name?: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: ModelDetails;
  capabilities?: string[];
}

/** Predicted memory use for a downloaded model, from /api/dashboard/estimates. */
export interface ModelEstimate {
  weights: number;
  /** The reference context, or less when the model or the GPU cannot take it. */
  baseContext: number;
  baseVram: number;
  /** Largest context that keeps the model fully on the GPU. */
  suggestedContext: number | null;
  suggestedVram: number | null;
  /** Whether the model fits at the base context; null when the GPU size is not configured. */
  fits: boolean | null;
}

export interface ModelEstimates {
  totalVram: number | null;
  /** Context that `baseVram` is normally quoted at. */
  referenceContext: number;
  models: Record<string, ModelEstimate>;
  /** KV cache type the estimates assume; missing means the f16 default. */
  kvCacheType?: "f16" | "q8_0" | "q4_0";
  /** Parallel requests the estimates assume; missing means 1. */
  numParallel?: number;
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface PsResponse {
  models: RunningModel[];
}

export interface TagsResponse {
  models: LocalModel[];
}

export interface VersionResponse {
  version: string;
}
