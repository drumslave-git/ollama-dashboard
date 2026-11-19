import { envNumber } from "./env.js";

/** Architecture facts that decide what each context token costs in memory. */
interface MemorySpec {
  maxContext: number | null;
  /** KV cache bytes per token, summed over layers that keep the whole context. */
  kvBytesPerToken: number;
  /** Same, for sliding-window layers, which only keep `windowTokens`. */
  kvWindowBytesPerToken: number;
  windowTokens: number;
}

export interface ModelEstimate {
  /** Largest context that keeps the model fully on the GPU, null if unknown or none fits. */
  suggestedContext: number | null;
  /** Context the memory figures below are for. */
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

/** Ollama stores the KV cache as f16 unless OLLAMA_KV_CACHE_TYPE says otherwise. */
const KV_BYTES_PER_VALUE = 2;
/** Default batch size; sliding-window layers keep the window plus one batch. */
const BATCH_TOKENS = 512;
/**
 * Share of the GPU a model may fill. The rest covers the driver and compute
 * buffers, which Ollama's own VRAM figure leaves out: a loaded qwen3.5:9b
 * reported weights plus KV cache and under 0.1 GiB more (Ollama 0.40.16).
 */
const VRAM_BUDGET = 0.9;
const MIN_CONTEXT = 4096;
/** Context to quote memory at when there is no GPU size to fit against. */
const REFERENCE_CONTEXT = 8192;
const SHOW_CONCURRENCY = 4;

type ModelInfo = Record<string, unknown>;

interface ShowResponse {
  model_info?: ModelInfo;
  capabilities?: string[];
}

interface TagsModel {
  name?: string;
  model: string;
  size: number;
  digest: string;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** GGUF keys hold one value for every layer, or an array with one per layer. */
function perLayer(value: unknown, layer: number): number | null {
  return Array.isArray(value) ? num(value[layer]) : num(value);
}

export function readMemorySpec(show: ShowResponse): MemorySpec {
  const info = show.model_info ?? {};
  const arch = info["general.architecture"];
  const key = (name: string) => info[`${arch}.${name}`];

  const spec: MemorySpec = {
    maxContext: num(key("context_length")),
    kvBytesPerToken: 0,
    kvWindowBytesPerToken: 0,
    windowTokens: 0,
  };

  // Encoders (embedding models) run one pass and keep no KV cache.
  const caps = show.capabilities ?? [];
  if (caps.includes("embedding") && !caps.includes("completion")) return spec;

  const layers = num(key("block_count")) ?? 0;
  const embedding = num(key("embedding_length")) ?? 0;
  const heads = key("attention.head_count");
  const headsKv = key("attention.head_count_kv");
  const keyLength = num(key("attention.key_length"));
  const valueLength = num(key("attention.value_length"));
  const keyLengthSwa = num(key("attention.key_length_swa")) ?? keyLength;
  const valueLengthSwa = num(key("attention.value_length_swa")) ?? valueLength;
  const window = num(key("attention.sliding_window")) ?? 0;
  const windowPattern = key("attention.sliding_window_pattern");
  // Hybrid models put attention on every Nth layer; the rest keep no KV cache.
  const attentionInterval = num(key("full_attention_interval"));
  // Latent attention (MLA) caches one compressed vector per layer instead of one per head.
  const keyLengthMla = num(key("attention.key_length_mla"));
  const valueLengthMla = num(key("attention.value_length_mla"));

  if (keyLengthMla != null && valueLengthMla != null) {
    spec.kvBytesPerToken =
      layers * (keyLengthMla + valueLengthMla) * KV_BYTES_PER_VALUE;
    return spec;
  }

  for (let i = 0; i < layers; i++) {
    const layerHeads = perLayer(heads, i) ?? 0;
    let kvHeads = perLayer(headsKv, i) ?? layerHeads;
    if (
      attentionInterval != null &&
      attentionInterval > 1 &&
      !Array.isArray(headsKv) &&
      (i + 1) % attentionInterval !== 0
    ) {
      kvHeads = 0;
    }
    if (kvHeads <= 0) continue;

    const headSize = layerHeads > 0 ? embedding / layerHeads : 0;
    const windowed =
      window > 0 && Array.isArray(windowPattern) && windowPattern[i] === true;
    const k = (windowed ? keyLengthSwa : keyLength) ?? headSize;
    const v = (windowed ? valueLengthSwa : valueLength) ?? headSize;
    const bytes = kvHeads * (k + v) * KV_BYTES_PER_VALUE;

    if (windowed) spec.kvWindowBytesPerToken += bytes;
    else spec.kvBytesPerToken += bytes;
  }

  if (spec.kvWindowBytesPerToken > 0) spec.windowTokens = window;
  return spec;
}

function contextMemory(spec: MemorySpec, context: number): number {
  const windowed = Math.min(context, spec.windowTokens + BATCH_TOKENS);
  return (
    spec.kvBytesPerToken * context + spec.kvWindowBytesPerToken * windowed
  );
}

/** Powers of two up to the model's limit, plus the limit itself. */
function contextSteps(maxContext: number): number[] {
  const steps: number[] = [];
  for (let c = MIN_CONTEXT; c < maxContext; c *= 2) steps.push(c);
  steps.push(maxContext);
  return steps;
}

export function estimateModel(
  spec: MemorySpec,
  weights: number,
  totalVram: number | null,
): ModelEstimate {
  const at = (
    context: number,
    suggestedContext: number | null,
    fits: boolean | null,
  ): ModelEstimate => {
    const ctxBytes = contextMemory(spec, context);
    return {
      suggestedContext,
      context,
      vram: weights + ctxBytes,
      weights,
      contextMemory: ctxBytes,
      fits,
    };
  };

  if (totalVram == null || spec.maxContext == null) {
    const context = Math.min(REFERENCE_CONTEXT, spec.maxContext ?? REFERENCE_CONTEXT);
    const estimate = at(context, null, null);
    if (totalVram != null) estimate.fits = estimate.vram <= totalVram * VRAM_BUDGET;
    return estimate;
  }

  const budget = totalVram * VRAM_BUDGET;
  const steps = contextSteps(spec.maxContext);
  const fitting = steps.filter(
    (c) => weights + contextMemory(spec, c) <= budget,
  );
  const best = fitting.at(-1);
  return best != null ? at(best, best, true) : at(steps[0], null, false);
}

/** Specs only change when the model does, so they are kept per digest. */
const specCache = new Map<string, MemorySpec>();

async function loadSpec(ollamaHost: string, model: TagsModel): Promise<MemorySpec | null> {
  const cached = specCache.get(model.digest);
  if (cached) return cached;

  try {
    const res = await fetch(`${ollamaHost}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.name?.trim() || model.model }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const spec = readMemorySpec((await res.json()) as ShowResponse);
    specCache.set(model.digest, spec);
    return spec;
  } catch {
    return null;
  }
}

export async function getModelEstimates(ollamaHost: string): Promise<ModelEstimates> {
  const host = ollamaHost.replace(/\/$/, "");
  const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Ollama /api/tags failed (${res.status})`);
  const tags = ((await res.json()) as { models?: TagsModel[] }).models ?? [];

  const totalGb = envNumber("GPU_VRAM_TOTAL_GB", 0);
  const totalVram = totalGb > 0 ? totalGb * 1024 ** 3 : null;
  const models: Record<string, ModelEstimate> = {};

  let next = 0;
  const worker = async () => {
    while (next < tags.length) {
      const model = tags[next++];
      const spec = await loadSpec(host, model);
      if (!spec) continue;
      const id = model.name?.trim() || model.model;
      models[id] = estimateModel(spec, model.size, totalVram);
    }
  };
  await Promise.all(Array.from({ length: SHOW_CONCURRENCY }, worker));

  return { totalVram, models };
}
