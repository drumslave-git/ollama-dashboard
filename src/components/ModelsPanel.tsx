import { useCallback, useEffect, useState } from "react";
import { fetchHfGgufFiles, type HfGgufFile } from "../api/huggingface";
import {
  deleteModel,
  localModelId,
  pullModel,
  waitForLocalModel,
} from "../api/ollama";
import {
  displayValue,
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
import type { LocalModel, ModelDetails, PullProgress } from "../types/ollama";
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

export function ModelsPanel({ models, onRefresh }: Props) {
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

      {models.length === 0 ? (
        <p className="empty models-empty">No models downloaded yet</p>
      ) : (
        <div className="table-wrap">
          <table className="models-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Size</th>
                <th className="p2">Capabilities</th>
                <th className="p3">Modified</th>
                <th className="p4">Digest</th>
                <th className="p4">Format</th>
                <th className="p3">Family</th>
                <th className="num">Params</th>
                <th>Quant</th>
                <th className="p5">Parent</th>
                <th className="num">Context</th>
                <th className="num p5">Embedding</th>
                <th className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const d = m.details;
                const id = localModelId(m);
                const caps = sortCapabilities(m.capabilities);
                const families = familyExtra(d);

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
            {models.map((m) => {
              const d = m.details;
              const id = localModelId(m);
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
