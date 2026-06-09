import { modelRefMatchesLocal } from "../lib/huggingface";
import type { GpuStats } from "../types/gpu";
import type {
  LocalModel,
  PullProgress,
  PsResponse,
  TagsResponse,
  VersionResponse,
} from "../types/ollama";

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function localModelId(model: LocalModel): string {
  return model.name?.trim() || model.model;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchRunningModels(): Promise<PsResponse> {
  const res = await fetch("/api/ps");
  return parseJson<PsResponse>(res);
}

export async function fetchLocalModels(): Promise<TagsResponse> {
  const res = await fetch("/api/tags");
  return parseJson<TagsResponse>(res);
}

export async function fetchVersion(): Promise<VersionResponse> {
  const res = await fetch("/api/version");
  return parseJson<VersionResponse>(res);
}

export async function fetchGpuStats(): Promise<GpuStats> {
  const res = await fetch("/api/dashboard/gpu");
  return parseJson<GpuStats>(res);
}

export async function unloadModel(name: string): Promise<void> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name, keep_alive: 0 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Unload failed (${res.status})`);
  }
}

export async function deleteModel(name: string): Promise<void> {
  const res = await fetch("/api/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name, name }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Delete failed (${res.status})`);
  }
}

function consumePullLine(
  line: string,
  onProgress: (progress: PullProgress) => void,
): PullProgress | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const progress = JSON.parse(trimmed) as PullProgress;
  onProgress(progress);
  return progress;
}

export async function pullModel(
  name: string,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name, name, stream: true }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Pull failed (${res.status})`);
  }

  if (!res.body) {
    throw new Error("No response body from pull");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastStatus: string | undefined;

  const handleLine = (line: string): boolean => {
    try {
      const progress = consumePullLine(line, onProgress);
      if (!progress) return false;
      lastStatus = progress.status;
      return progress.status === "success";
    } catch {
      return false;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (handleLine(line)) return;
    }
  }

  buffer += decoder.decode();
  if (handleLine(buffer)) return;

  throw new Error(lastStatus || "Pull finished without success");
}

export async function waitForLocalModel(
  pullName: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<LocalModel | null> {
  const attempts = options?.attempts ?? 10;
  const delayMs = options?.delayMs ?? 600;

  for (let i = 0; i < attempts; i++) {
    const { models } = await fetchLocalModels();
    const found = models.find((m) =>
      modelRefMatchesLocal(pullName, localModelId(m)),
    );
    if (found) return found;
    if (i < attempts - 1) await sleep(delayMs);
  }

  return null;
}
