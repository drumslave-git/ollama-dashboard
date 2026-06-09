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
