import { localModelId } from "../api/ollama";
import type { LocalModel, ModelEstimates } from "../types/ollama";
import { sortCapabilities } from "./format";

export type SortKey =
  | "name"
  | "size"
  | "modified"
  | "family"
  | "params"
  | "quant"
  | "context"
  | "suggested"
  | "vram";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export interface FilterState {
  capabilities: string[];
  families: string[];
}

export interface TableState {
  sort: SortState;
  filters: FilterState;
}

/** Text columns start A→Z; numbers and dates start largest or newest first. */
const TEXT_KEYS: ReadonlySet<SortKey> = new Set(["name", "family", "quant"]);

export const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  size: "Size",
  modified: "Modified",
  family: "Family",
  params: "Params",
  quant: "Quant",
  context: "Context",
  suggested: "Suggested ctx",
  vram: "Est. VRAM",
};

export function defaultDir(key: SortKey): SortDir {
  return TEXT_KEYS.has(key) ? "asc" : "desc";
}

/** Ollama lists models newest first, so that stays the starting order. */
export const DEFAULT_TABLE_STATE: TableState = {
  sort: { key: "modified", dir: "desc" },
  filters: { capabilities: [], families: [] },
};

/** Clicking the active column flips it; another column starts in its natural direction. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: defaultDir(key) };
}

/** Words for the direction, in the column's own terms. */
export function dirLabel(key: SortKey, dir: SortDir): string {
  if (TEXT_KEYS.has(key)) return dir === "asc" ? "A to Z" : "Z to A";
  if (key === "modified") return dir === "desc" ? "newest first" : "oldest first";
  return dir === "desc" ? "largest first" : "smallest first";
}

const PARAM_UNITS: Record<string, number> = {
  "": 1,
  K: 1e3,
  M: 1e6,
  B: 1e9,
  T: 1e12,
};

/** "7.6B" → 7.6e9, "566.70M" → 5.667e8; null when Ollama gives no usable figure. */
export function parseParameterSize(value: string | undefined): number | null {
  const match = /^\s*([\d.]+)\s*([KMBT]?)\s*$/i.exec(value ?? "");
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  return n * PARAM_UNITS[match[2].toUpperCase()];
}

/** Primary family plus any extra ones, without blanks or repeats. */
export function modelFamilies(model: LocalModel): string[] {
  const d = model.details;
  const all = [d?.family, ...(d?.families ?? [])];
  return [...new Set(all.filter((f): f is string => !!f && f.trim() !== ""))];
}

function text(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value : null;
}

function sortValue(
  model: LocalModel,
  key: SortKey,
  estimates: ModelEstimates | null,
): string | number | null {
  const d = model.details;
  const est = estimates?.models[localModelId(model)];
  switch (key) {
    case "name":
      return localModelId(model);
    case "size":
      return Number.isFinite(model.size) ? model.size : null;
    case "modified": {
      const t = Date.parse(model.modified_at);
      return Number.isNaN(t) ? null : t;
    }
    case "family":
      return text(d?.family);
    case "params":
      return parseParameterSize(d?.parameter_size);
    case "quant":
      return text(d?.quantization_level);
    case "context":
      return d?.context_length ?? null;
    case "suggested":
      return est?.suggestedContext ?? null;
    case "vram":
      return est?.baseVram ?? null;
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Sorted copy. Missing values go last in both directions; ties fall back to the name. */
export function sortModels(
  models: LocalModel[],
  sort: SortState,
  estimates: ModelEstimates | null,
): LocalModel[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  const rows = models.map((m) => ({
    m,
    v: sortValue(m, sort.key, estimates),
    name: localModelId(m),
  }));
  rows.sort((a, b) => {
    if (a.v == null || b.v == null) {
      if (a.v == null && b.v != null) return 1;
      if (b.v == null && a.v != null) return -1;
    } else {
      const c =
        typeof a.v === "number" && typeof b.v === "number"
          ? a.v - b.v
          : collator.compare(String(a.v), String(b.v));
      if (c !== 0) return factor * c;
    }
    return collator.compare(a.name, b.name);
  });
  return rows.map((r) => r.m);
}

export interface FilterOption {
  value: string;
  count: number;
}

/** Options for the filter chips, taken from the loaded models. */
export function filterOptions(models: LocalModel[]): {
  capabilities: FilterOption[];
  families: FilterOption[];
} {
  const caps = new Map<string, number>();
  const fams = new Map<string, number>();
  for (const m of models) {
    for (const c of new Set(m.capabilities ?? [])) caps.set(c, (caps.get(c) ?? 0) + 1);
    for (const f of modelFamilies(m)) fams.set(f, (fams.get(f) ?? 0) + 1);
  }
  return {
    capabilities: sortCapabilities([...caps.keys()]).map((value) => ({
      value,
      count: caps.get(value)!,
    })),
    families: [...fams.keys()]
      .sort((a, b) => collator.compare(a, b))
      .map((value) => ({ value, count: fams.get(value)! })),
  };
}

/** Every selected capability (AND) and any selected family (OR). */
export function matchesFilters(model: LocalModel, filters: FilterState): boolean {
  const caps = model.capabilities ?? [];
  if (!filters.capabilities.every((c) => caps.includes(c))) return false;
  if (filters.families.length === 0) return true;
  const fams = modelFamilies(model);
  return filters.families.some((f) => fams.includes(f));
}

export function hasFilters(filters: FilterState): boolean {
  return filters.capabilities.length > 0 || filters.families.length > 0;
}

const STORAGE_KEY = "ollama-dashboard:models-table";

const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[];

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === "string" && v !== ""))]
    : [];
}

/** Saved sort and filters, or the defaults when nothing usable is stored. */
export function loadTableState(): TableState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TABLE_STATE;
    const data = JSON.parse(raw) as Partial<{
      sort: { key?: unknown; dir?: unknown };
      filters: { capabilities?: unknown; families?: unknown };
    }>;
    const key = data?.sort?.key;
    const dir = data?.sort?.dir;
    const sort: SortState =
      typeof key === "string" && SORT_KEYS.includes(key as SortKey)
        ? {
            key: key as SortKey,
            dir: dir === "asc" || dir === "desc" ? dir : defaultDir(key as SortKey),
          }
        : DEFAULT_TABLE_STATE.sort;
    return {
      sort,
      filters: {
        capabilities: stringList(data?.filters?.capabilities),
        families: stringList(data?.filters?.families),
      },
    };
  } catch {
    return DEFAULT_TABLE_STATE;
  }
}

export function saveTableState(state: TableState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be full or blocked; the table still works for this visit.
  }
}

/** Plain-language note when the estimates assume a non-default KV cache or parallelism. */
export function estimateAssumptions(estimates: ModelEstimates | null): string | null {
  if (!estimates) return null;
  const parts: string[] = [];
  const kv = estimates.kvCacheType;
  if (kv && kv !== "f16") parts.push(`${kv} KV cache`);
  const parallel = estimates.numParallel;
  if (parallel != null && parallel !== 1) {
    parts.push(`${parallel} parallel ${parallel === 1 ? "request" : "requests"}`);
  }
  return parts.length > 0 ? `Estimates assume ${parts.join(" and ")}` : null;
}
