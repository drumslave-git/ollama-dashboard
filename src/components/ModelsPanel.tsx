import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchHfGgufFiles, type HfGgufFile } from "../api/huggingface";
import {
  deleteModel,
  localModelId,
  pullModel,
  waitForLocalModel,
} from "../api/ollama";
import {
  compactContext,
  displayValue,
  estimateBreakdown,
  formatBytes,
  formatDateTime,
  pullStatusLabel,
  shortDigest,
  sortCapabilities,
  splitModelRef,
} from "../lib/format";
import {
  buildOllamaHfPullName,
  parseHuggingFaceInput,
} from "../lib/huggingface";
import {
  defaultDir,
  dirLabel,
  estimateAssumptions,
  filterOptions,
  hasFilters,
  loadTableState,
  matchesFilters,
  nextSort,
  saveTableState,
  SORT_LABELS,
  sortModels,
  type FilterOption,
  type FilterState,
  type SortKey,
  type SortState,
  type TableState,
} from "../lib/modelTable";
import { useModelEstimates } from "../hooks/useModelEstimates";
import type {
  LocalModel,
  ModelDetails,
  ModelEstimate,
  PullProgress,
} from "../types/ollama";
import { BlockBar } from "./BlockBar";

interface Props {
  models: LocalModel[];
  onRefresh: () => void;
}

type PullState = {
  target: string;
  progress: PullProgress | null;
  error: string | null;
};

/** Model ref with its namespace (`hf.co/user/`) on a muted line above the name. */
function ModelRef({ value }: { value: string }) {
  const { prefix, rest } = splitModelRef(value);
  return (
    <>
      {prefix && <span className="ref-prefix">{prefix}</span>}
      {rest}
    </>
  );
}

function familyExtra(d: ModelDetails | undefined): string | null {
  const families = d?.families ?? [];
  const extra = families.filter((f) => f !== d?.family);
  return extra.length > 0 ? extra.join(", ") : null;
}

/** Estimated VRAM at the base context, as a share of the GPU when its size is known. */
function vramLabel(est: ModelEstimate, totalVram: number | null): string {
  const size = formatBytes(est.baseVram);
  if (totalVram == null || totalVram <= 0) return size;
  return `${size} · ${Math.round((est.baseVram / totalVram) * 100)}%`;
}

/** Second line of the estimate: memory at the suggested context, or why the first line differs. */
function vramNote(est: ModelEstimate, referenceContext: number): string | null {
  if (est.fits === false) return "over GPU";
  if (
    est.suggestedContext != null &&
    est.suggestedVram != null &&
    est.suggestedContext !== est.baseContext
  ) {
    return `${formatBytes(est.suggestedVram)} at ${est.suggestedContext.toLocaleString()}`;
  }
  if (est.baseContext !== referenceContext) {
    return `at ${est.baseContext.toLocaleString()} ctx`;
  }
  return null;
}

function suggestionHint(est: ModelEstimate): string {
  if (est.suggestedContext != null) {
    return "Largest context that keeps this model fully on the GPU";
  }
  if (est.fits === false) {
    return "Too large for the GPU at any context. Ollama will split it with system RAM.";
  }
  return "Set GPU_VRAM_TOTAL_GB to get a suggestion";
}

/** Small chevron for the sorted column; the state itself is in aria-sort. */
function SortMark({ dir }: { dir: SortState["dir"] }) {
  return (
    <svg
      className="sort-mark"
      width="8"
      height="8"
      viewBox="0 0 8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={dir === "asc" ? "M1 5.5 4 2.5l3 3" : "M1 2.5 4 5.5l3-3"} />
    </svg>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[];

function FilterGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const labelId = useId();
  if (options.length === 0) return null;
  return (
    <div className="filter-group" role="group" aria-labelledby={labelId}>
      <span className="filter-label" id={labelId}>
        {label}
      </span>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            className="chip"
            aria-pressed={on}
            onClick={() => onToggle(o.value)}
          >
            <span className="chip-mark" aria-hidden />
            {o.value}
            <span className="chip-count">{o.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ModelsPanel({ models, onRefresh }: Props) {
  const estimates = useModelEstimates(models);
  const [table, setTable] = useState<TableState>(loadTableState);
  const [sortStatus, setSortStatus] = useState("");
  const sort = table.sort;
  const options = useMemo(() => filterOptions(models), [models]);

  // A selected option whose models are gone no longer filters anything.
  const filters = useMemo<FilterState>(() => {
    if (models.length === 0) return table.filters;
    const caps = new Set(options.capabilities.map((o) => o.value));
    const fams = new Set(options.families.map((o) => o.value));
    return {
      capabilities: table.filters.capabilities.filter((c) => caps.has(c)),
      families: table.filters.families.filter((f) => fams.has(f)),
    };
  }, [models.length, options, table.filters]);
  const filtering = hasFilters(filters);

  useEffect(() => {
    const pruned =
      filters.capabilities.length !== table.filters.capabilities.length ||
      filters.families.length !== table.filters.families.length;
    if (pruned) setTable((prev) => ({ ...prev, filters }));
  }, [filters, table.filters]);

  useEffect(() => {
    saveTableState(table);
  }, [table]);

  const visible = useMemo(
    () =>
      sortModels(
        models.filter((m) => matchesFilters(m, filters)),
        sort,
        estimates,
      ),
    [models, filters, sort, estimates],
  );

  const applySort = (next: SortState) => {
    setTable((prev) => ({ ...prev, sort: next }));
    setSortStatus(
      `Sorted by ${SORT_LABELS[next.key]}, ${dirLabel(next.key, next.dir)}`,
    );
  };

  const toggleFilter = (group: keyof FilterState, value: string) => {
    setTable((prev) => {
      const list = prev.filters[group];
      const nextList = list.includes(value)
        ? list.filter((v) => v !== value)
        : [...list, value];
      return { ...prev, filters: { ...prev.filters, [group]: nextList } };
    });
  };

  const clearFilters = () =>
    setTable((prev) => ({
      ...prev,
      filters: { capabilities: [], families: [] },
    }));

  const assumptions = estimateAssumptions(estimates);

  const sortHeader = (
    key: SortKey,
    label: ReactNode,
    className?: string,
    title?: string,
  ) => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        className={className ? `${className} sortable` : "sortable"}
        aria-sort={
          active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
        }
        title={title}
      >
        <button
          type="button"
          className="sort-button"
          onClick={() => applySort(nextSort(sort, key))}
        >
          {label}
          {active && <SortMark dir={sort.dir} />}
        </button>
      </th>
    );
  };
  const totalVram = estimates?.totalVram ?? null;
  const vramHeading = estimates
    ? `Est. VRAM at ${compactContext(estimates.referenceContext)}`
    : "Est. VRAM";
  const noteFor = (est: ModelEstimate | undefined) =>
    est && estimates ? vramNote(est, estimates.referenceContext) : null;
  const [tag, setTag] = useState("");
  const [hfFiles, setHfFiles] = useState<HfGgufFile[]>([]);
  const [hfQuant, setHfQuant] = useState("");
  const [hfLookupError, setHfLookupError] = useState<string | null>(null);
  const [hfLookupLoading, setHfLookupLoading] = useState(false);
  const [pull, setPull] = useState<PullState | null>(null);
  const [pullNote, setPullNote] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const busy = pull !== null || bulkRunning || deleting !== null;

  const hfRef = parseHuggingFaceInput(tag);

  useEffect(() => {
    if (!hfRef) {
      setHfFiles([]);
      setHfQuant("");
      setHfLookupError(null);
      setHfLookupLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setHfLookupLoading(true);
      setHfLookupError(null);
      void fetchHfGgufFiles(hfRef.repo)
        .then((files) => {
          if (cancelled) return;
          setHfFiles(files);
          if (files.length === 0) {
            setHfQuant("");
            setHfLookupError("No GGUF files found in this repo");
            return;
          }
          const preferred =
            files.find((f) => f.quant === hfRef.quant)?.quant ??
            files.find((f) => f.quant === "Q4_K_M")?.quant ??
            files.find((f) => f.quant === "Q4_K_S")?.quant ??
            files[0].quant;
          setHfQuant(preferred);
        })
        .catch((err) => {
          if (cancelled) return;
          setHfFiles([]);
          setHfQuant("");
          setHfLookupError(
            err instanceof Error ? err.message : "Lookup failed",
          );
        })
        .finally(() => {
          if (!cancelled) setHfLookupLoading(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hfRef?.repo, hfRef?.quant]);

  const runPull = useCallback(
    async (name: string) => {
      setPullNote(null);
      setPull({ target: name, progress: null, error: null });
      try {
        await pullModel(name, (progress) => {
          setPull((prev) =>
            prev?.target === name ? { ...prev, progress } : prev,
          );
        });
        const found = await waitForLocalModel(name);
        onRefresh();
        if (found) {
          setPullNote(`Added as ${localModelId(found)}`);
        } else {
          setPullNote(
            "Pull finished but the model is not listed yet. Try Refresh — Hugging Face models appear as hf.co/user/repo:quant.",
          );
        }
      } catch (err) {
        setPull({
          target: name,
          progress: null,
          error: err instanceof Error ? err.message : "Pull failed",
        });
      } finally {
        setTimeout(() => setPull(null), 2500);
        setTimeout(() => setPullNote(null), 10_000);
      }
    },
    [onRefresh],
  );

  const runDelete = useCallback(
    async (name: string) => {
      if (!confirm(`Delete "${name}"? This frees disk space and cannot be undone.`)) {
        return;
      }
      setDeleting(name);
      try {
        await deleteModel(name);
        onRefresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Delete failed");
      } finally {
        setDeleting(null);
      }
    },
    [onRefresh],
  );

  const resolvePullName = (input: string): string => {
    const trimmed = input.trim();
    const ref = parseHuggingFaceInput(trimmed);
    if (!ref) return trimmed;
    const quant = hfQuant || ref.quant;
    return buildOllamaHfPullName(ref.repo, quant);
  };

  const handlePull = () => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    void runPull(resolvePullName(trimmed));
    setTag("");
    setHfFiles([]);
    setHfQuant("");
    setHfLookupError(null);
  };

  const handleBulkUpdate = async () => {
    if (models.length === 0) return;
    setBulkRunning(true);
    for (const m of models) {
      const id = localModelId(m);
      setPull({ target: id, progress: { status: "queued" }, error: null });
      try {
        await pullModel(id, (progress) => {
          setPull({ target: id, progress, error: null });
        });
      } catch (err) {
        setPull({
          target: id,
          progress: null,
          error: err instanceof Error ? err.message : "Update failed",
        });
        break;
      }
    }
    setBulkRunning(false);
    setTimeout(() => setPull(null), 2500);
    onRefresh();
  };

  const statusLabel = pull ? pullStatusLabel(pull.progress) : null;
  const downloadPct =
    pull?.progress?.total != null &&
    pull.progress.total > 0 &&
    pull.progress.completed != null
      ? Math.round((pull.progress.completed / pull.progress.total) * 100)
      : null;

  const rowActions = (id: string) => (
    <div className="row-actions">
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={() => void runPull(id)}
        disabled={busy}
      >
        Update
      </button>
      <button
        type="button"
        className="btn-ghost-danger btn-sm"
        onClick={() => void runDelete(id)}
        disabled={busy}
      >
        {deleting === id ? "Deleting…" : "Delete"}
      </button>
    </div>
  );

  return (
    <div className="card">
      <div className="card-header models-header">
        <div className="card-heading">
          <h2 className="card-title">Models</h2>
          <span className="card-meta">{models.length} downloaded</span>
        </div>
        <div className="actions-row-buttons">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => onRefresh()}
            disabled={busy}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => void handleBulkUpdate()}
            disabled={busy || models.length === 0}
            title="Re-pull every downloaded model"
          >
            Update all
          </button>
        </div>
      </div>

      <div className="pull-form">
        <input
          type="text"
          placeholder="Ollama tag or Hugging Face repo"
          aria-label="Model to pull"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handlePull()}
          disabled={busy}
          spellCheck={false}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={handlePull}
          disabled={
            busy ||
            !tag.trim() ||
            (hfRef !== null && hfFiles.length > 0 && !hfQuant)
          }
        >
          Pull
        </button>
      </div>

      {hfRef && (
        <div className="hf-pull-panel">
          <div className="hf-pull-meta">
            <span className="mono">
              {buildOllamaHfPullName(hfRef.repo, hfQuant || hfRef.quant)}
            </span>
            {hfLookupLoading && (
              <span className="hf-pull-status">Looking up GGUF files…</span>
            )}
          </div>
          {hfFiles.length > 0 && (
            <label className="hf-quant-row">
              <span>Quantization</span>
              <select
                value={hfQuant}
                onChange={(e) => setHfQuant(e.target.value)}
                disabled={busy}
              >
                {hfFiles.map((f) => (
                  <option key={f.path} value={f.quant}>
                    {f.quant} · {formatBytes(f.size)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {hfLookupError && (
            <div className="hf-pull-error">{hfLookupError}</div>
          )}
        </div>
      )}

      {pullNote && <div className="pull-note">{pullNote}</div>}

      {pull && (
        <div className="progress-panel">
          <div className="progress-head">
            <span className="progress-target">
              {pull.target}
              {statusLabel && (
                <span className="progress-status"> · {statusLabel}</span>
              )}
            </span>
            {downloadPct != null && (
              <span className="progress-figures">
                {downloadPct}% · {formatBytes(pull.progress!.completed ?? 0)} of{" "}
                {formatBytes(pull.progress!.total ?? 0)}
              </span>
            )}
          </div>
          {downloadPct != null && <BlockBar percent={downloadPct} />}
          {pull.error && <div className="progress-error">{pull.error}</div>}
        </div>
      )}

      {models.length > 0 && (
        <div className="model-filters">
          <FilterGroup
            label="Capabilities"
            options={options.capabilities}
            selected={filters.capabilities}
            onToggle={(v) => toggleFilter("capabilities", v)}
          />
          <FilterGroup
            label="Family"
            options={options.families}
            selected={filters.families}
            onToggle={(v) => toggleFilter("families", v)}
          />
          {filtering && (
            <div className="filter-summary">
              <span className="filter-count">
                {visible.length} of {models.length} models
              </span>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={clearFilters}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {assumptions && models.length > 0 && (
        <p className="estimate-note">{assumptions}</p>
      )}

      <p className="sr-only" role="status">
        {sortStatus}
      </p>

      {models.length === 0 ? (
        <p className="empty models-empty">No models downloaded yet</p>
      ) : visible.length === 0 ? (
        <div className="filter-empty">
          <p className="empty">No models match these filters.</p>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={clearFilters}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          {/* Shown when the header row cannot show the order: stacked list, or sorted column hidden */}
          <div className="list-sort">
            <label className="list-sort-field">
              <span>Sort by</span>
              <select
                value={sort.key}
                onChange={(e) => {
                  const key = e.target.value as SortKey;
                  applySort({ key, dir: defaultDir(key) });
                }}
              >
                {SORT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => applySort(nextSort(sort, sort.key))}
            >
              <SortMark dir={sort.dir} />
              {capitalize(dirLabel(sort.key, sort.dir))}
            </button>
          </div>
          <table className="models-table">
            <thead>
              <tr>
                {sortHeader("name", "Name")}
                {sortHeader("size", "Size", "num")}
                <th scope="col" className="p2">
                  Capabilities
                </th>
                {sortHeader("modified", "Modified", "p3")}
                <th scope="col" className="p4">
                  Digest
                </th>
                <th scope="col" className="p4">
                  Format
                </th>
                {sortHeader("family", "Family", "p3")}
                {sortHeader("params", "Params", "num")}
                {sortHeader("quant", "Quant")}
                <th scope="col" className="p5">
                  Parent
                </th>
                {sortHeader("context", "Context", "num")}
                {sortHeader("suggested", "Suggested ctx", "num")}
                {sortHeader("vram", vramHeading, "num", assumptions ?? undefined)}
                <th scope="col" className="num p5">
                  Embedding
                </th>
                <th scope="col" className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const d = m.details;
                const id = localModelId(m);
                const caps = sortCapabilities(m.capabilities);
                const families = familyExtra(d);
                const est = estimates?.models[id];
                const note = noteFor(est);

                return (
                  <tr key={`${id}:${m.digest || m.modified_at}`}>
                    <td className="name-cell">
                      <ModelRef value={id} />
                      {m.model !== id && (
                        <div className="cell-sub">
                          <ModelRef value={m.model} />
                        </div>
                      )}
                    </td>
                    <td className="num mono">{formatBytes(m.size)}</td>
                    <td className="capabilities-cell p2">
                      {caps.length > 0 ? caps.join(", ") : <Empty />}
                    </td>
                    <td className="mono p3" title={m.modified_at}>
                      {formatDateTime(m.modified_at)}
                    </td>
                    <td className="mono digest p4" title={m.digest}>
                      {shortDigest(m.digest)}
                    </td>
                    <td className="p4">{d?.format || <Empty />}</td>
                    <td className="p3">
                      {d?.family || <Empty />}
                      {families && <div className="cell-sub">{families}</div>}
                    </td>
                    <td className="num mono">{d?.parameter_size || <Empty />}</td>
                    <td className="mono">{d?.quantization_level || <Empty />}</td>
                    <td className="mono p5" title={d?.parent_model || undefined}>
                      {d?.parent_model ? (
                        <div className="parent-ref">
                          <ModelRef value={d.parent_model} />
                        </div>
                      ) : (
                        <Empty />
                      )}
                    </td>
                    <td className="num mono">
                      {d?.context_length != null
                        ? d.context_length.toLocaleString()
                        : <Empty />}
                    </td>
                    <td
                      className="num mono"
                      title={est ? suggestionHint(est) : undefined}
                    >
                      {est?.suggestedContext != null
                        ? est.suggestedContext.toLocaleString()
                        : <Empty />}
                    </td>
                    <td
                      className={est?.fits === false ? "num mono over" : "num mono"}
                      title={est ? estimateBreakdown(est) : undefined}
                    >
                      {est ? vramLabel(est, totalVram) : <Empty />}
                      {note && <div className="cell-sub">{note}</div>}
                    </td>
                    <td className="num mono p5">
                      {d?.embedding_length != null
                        ? d.embedding_length.toLocaleString()
                        : <Empty />}
                    </td>
                    <td className="col-actions">{rowActions(id)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Narrow cards show the library as a stacked list instead of a scrolling table */}
          <ul className="models-list">
            {visible.map((m) => {
              const d = m.details;
              const id = localModelId(m);
              const est = estimates?.models[id];
              const note = noteFor(est);
              return (
                <li key={`${id}:${m.digest || m.modified_at}`} className="models-list-item">
                  <div className="models-list-name">
                    <ModelRef value={id} />
                  </div>
                  <dl className="model-meta">
                    <div>
                      <dt>Size</dt>
                      <dd>{formatBytes(m.size)}</dd>
                    </div>
                    {d?.family && (
                      <div>
                        <dt>Family</dt>
                        <dd>{d.family}</dd>
                      </div>
                    )}
                    {d?.parameter_size && (
                      <div>
                        <dt>Params</dt>
                        <dd>{d.parameter_size}</dd>
                      </div>
                    )}
                    {d?.quantization_level && (
                      <div>
                        <dt>Quant</dt>
                        <dd>{d.quantization_level}</dd>
                      </div>
                    )}
                    {d?.context_length != null && (
                      <div>
                        <dt>Context</dt>
                        <dd>{d.context_length.toLocaleString()}</dd>
                      </div>
                    )}
                    {est?.suggestedContext != null && (
                      <div>
                        <dt>Suggested ctx</dt>
                        <dd>{est.suggestedContext.toLocaleString()}</dd>
                      </div>
                    )}
                    {est && (
                      <div>
                        <dt>{vramHeading}</dt>
                        <dd className={est.fits === false ? "over" : undefined}>
                          {vramLabel(est, totalVram)}
                          {note && `, ${note}`}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Modified</dt>
                      <dd>{formatDateTime(m.modified_at)}</dd>
                    </div>
                  </dl>
                  {rowActions(id)}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <span className="cell-empty">{displayValue(null)}</span>;
}
