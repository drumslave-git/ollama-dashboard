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
  /** Largest context that keeps the model fully on the GPU. */
  suggestedContext: number | null;
  /** Context the memory figures are for. */
  context: number;
  vram: number;
  weights: number;
  contextMemory: number;
  /** null when the GPU size is not configured. */
  fits: boolean | null;
}

export interface ModelEstimates {
  totalVram: number | null;
  models: Record<string, ModelEstimate>;
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
