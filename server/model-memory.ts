import { envNumber } from "./env.js";

/** Architecture facts that decide what each context token costs in memory. */
interface MemorySpec {
  maxContext: number | null;
  /** KV cache values per token, summed over layers that keep the whole context. */
  kvValuesPerToken: number;
  /** Same, for sliding-window layers, which only keep `windowTokens`. */
  kvWindowValuesPerToken: number;
  windowTokens: number;
}

export type KvCacheType = "f16" | "q8_0" | "q4_0";

/** How the Ollama server stores its KV cache; it does not report this, so it comes from env. */
export interface KvSettings {
  kvCacheType: KvCacheType;
  /** Parallel request slots; each one holds its own full context. */
  numParallel: number;
}

/** Ollama's defaults (0.40): f16 cache, one request at a time. */
export const DEFAULT_KV_SETTINGS: KvSettings = { kvCacheType: "f16", numParallel: 1 };

export interface ModelEstimate {
  weights: number;
  /** The reference context, or less when the model or the GPU cannot take it. */
  baseContext: number;
  baseVram: number;
  /** Largest context that keeps the model fully on the GPU, null if unknown or none fits. */
  suggestedContext: number | null;
  suggestedVram: number | null;
  /** Whether the model fits at the base context; null when the GPU size is not configured. */
  fits: boolean | null;
}

export interface ModelEstimates {
  totalVram: number | null;
  /** Context that `baseVram` is normally quoted at. */
  referenceContext: number;
  /** The KV cache settings the estimates were made with. */
  kvCacheType: KvCacheType;
  numParallel: number;
  models: Record<string, ModelEstimate>;
}

/**
 * Bytes per cached value. Quantised types store blocks of 32 values with one
 * f16 scale: q8_0 is 34 bytes per block, q4_0 is 18 (GGML block sizes).
 */
const KV_BYTES_PER_VALUE: Record<KvCacheType, number> = {
  f16: 2,
  q8_0: 34 / 32,
  q4_0: 18 / 32,
};

function isKvCacheType(value: string): value is KvCacheType {
  return Object.hasOwn(KV_BYTES_PER_VALUE, value);
}

/**
 * Reads OLLAMA_KV_CACHE_TYPE and OLLAMA_NUM_PARALLEL, which must mirror the
 * Ollama server's own settings. Invalid values fall back to the defaults with
 * a warning. Call once, after the env is loaded.
 */
export function readKvSettings(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
): KvSettings {
  const settings = { ...DEFAULT_KV_SETTINGS };

  const rawType = env.OLLAMA_KV_CACHE_TYPE?.trim().toLowerCase() ?? "";
  if (isKvCacheType(rawType)) {
    settings.kvCacheType = rawType;
  } else if (rawType !== "") {
    warn(
      `OLLAMA_KV_CACHE_TYPE="${env.OLLAMA_KV_CACHE_TYPE}" is not f16, q8_0 or q4_0; using f16.`,
    );
  }

  const rawParallel = env.OLLAMA_NUM_PARALLEL?.trim() ?? "";
  if (rawParallel !== "") {
    const parallel = Math.floor(Number(rawParallel));
    if (Number.isFinite(parallel) && parallel >= 1) {
      settings.numParallel = parallel;
    } else {
      warn(
        `OLLAMA_NUM_PARALLEL="${env.OLLAMA_NUM_PARALLEL}" is not a positive integer; using 1.`,
      );
    }
  }

  return settings;
}

/** Default batch size; sliding-window layers keep the window plus one batch. */
const BATCH_TOKENS = 512;
/**
 * Share of the GPU a model may fill. The rest covers the driver and compute
 * buffers, which Ollama's own VRAM figure leaves out: a loaded qwen3.5:9b
 * reported weights plus KV cache and under 0.1 GiB more (Ollama 0.40.16).
 */
const VRAM_BUDGET = 0.9;
/** Suggestions move in steps of this many tokens; it is also the smallest one offered. */
const CONTEXT_STEP = 4096;
/** A typical working context, so memory figures compare across models. */
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
    kvValuesPerToken: 0,
    kvWindowValuesPerToken: 0,
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
    spec.kvValuesPerToken = layers * (keyLengthMla + valueLengthMla);
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
    const values = kvHeads * (k + v);

    if (windowed) spec.kvWindowValuesPerToken += values;
    else spec.kvValuesPerToken += values;
  }

  if (spec.kvWindowValuesPerToken > 0) spec.windowTokens = window;
  return spec;
}

/**
 * KV cache for a per-request context. Each parallel slot holds its own copy,
 * and a sliding-window layer keeps at most the window plus one batch per slot
 * (llama.cpp sizes the cache this way unless it is unified).
 */
function contextMemory(spec: MemorySpec, context: number, kv: KvSettings): number {
  const windowed = Math.min(context, spec.windowTokens + BATCH_TOKENS);
  const values =
    spec.kvValuesPerToken * context + spec.kvWindowValuesPerToken * windowed;
  return kv.numParallel * KV_BYTES_PER_VALUE[kv.kvCacheType] * values;
}

/** The model's limit if it fits, else the largest multiple of CONTEXT_STEP that does. */
function largestFittingContext(
  maxContext: number,
  fits: (context: number) => boolean,
): number | null {
  if (fits(maxContext)) return maxContext;
  const below = Math.floor((maxContext - 1) / CONTEXT_STEP) * CONTEXT_STEP;
  for (let c = below; c >= CONTEXT_STEP; c -= CONTEXT_STEP) {
    if (fits(c)) return c;
  }
  return null;
}

export function estimateModel(
  spec: MemorySpec,
  weights: number,
  totalVram: number | null,
  kv: KvSettings = DEFAULT_KV_SETTINGS,
): ModelEstimate {
  const vramAt = (context: number) => weights + contextMemory(spec, context, kv);
  const budget = totalVram != null ? totalVram * VRAM_BUDGET : null;

  let suggestedContext: number | null = null;
  if (budget != null && spec.maxContext != null) {
    suggestedContext = largestFittingContext(
      spec.maxContext,
      (c) => vramAt(c) <= budget,
    );
  }

  const baseContext = Math.min(
    REFERENCE_CONTEXT,
    spec.maxContext ?? REFERENCE_CONTEXT,
    suggestedContext ?? REFERENCE_CONTEXT,
  );
  const baseVram = vramAt(baseContext);

  return {
    weights,
    baseContext,
    baseVram,
    suggestedContext,
    suggestedVram: suggestedContext != null ? vramAt(suggestedContext) : null,
    fits: budget != null ? baseVram <= budget : null,
  };
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

export async function getModelEstimates(
  ollamaHost: string,
  kv: KvSettings,
): Promise<ModelEstimates> {
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
      models[id] = estimateModel(spec, model.size, totalVram, kv);
    }
  };
  await Promise.all(Array.from({ length: SHOW_CONCURRENCY }, worker));

  return {
    totalVram,
    referenceContext: REFERENCE_CONTEXT,
    kvCacheType: kv.kvCacheType,
    numParallel: kv.numParallel,
    models,
  };
}
