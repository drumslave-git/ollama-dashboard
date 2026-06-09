import { useCallback, useEffect, useState } from "react";
import { fetchHfGgufFiles, type HfGgufFile } from "../api/huggingface";
import {
  deleteModel,
  localModelId,
  pullModel,
  waitForLocalModel,
} from "../api/ollama";
import {
  displayList,
  displayValue,
  formatBytes,
  pullStatusLabel,
  shortDigest,
} from "../lib/format";
import {
  buildOllamaHfPullName,
  parseHuggingFaceInput,
} from "../lib/huggingface";
import type { LocalModel, PullProgress } from "../types/ollama";

interface Props {
  models: LocalModel[];
  onRefresh: () => void;
}

type PullState = {
  target: string;
  progress: PullProgress | null;
  error: string | null;
};

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
            setHfLookupError("No GGUF files found in this repo.");
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

  return (
    <div className="card">
      <h2>Models</h2>

      <div className="pull-form">
        <input
          type="text"
          placeholder="Ollama tag or Hugging Face URL (e.g. llama3.2:latest)"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handlePull()}
          disabled={busy}
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
            <span className="mono-cell">{buildOllamaHfPullName(hfRef.repo, hfQuant || hfRef.quant)}</span>
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
                    {f.quant} ({formatBytes(f.size)})
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

      <div className="actions-row">
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          {models.length} downloaded
        </span>
        <div className="actions-row-buttons">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onRefresh()}
            disabled={busy}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void handleBulkUpdate()}
            disabled={busy || models.length === 0}
          >
            Bulk update (re-pull all)
          </button>
        </div>
      </div>

      {pullNote && (
        <div className="pull-note">{pullNote}</div>
      )}

      {pull && (
        <div className="progress-panel">
          <div className="status">
            {pull.target}
            {statusLabel ? `: ${statusLabel}` : ""}
          </div>
          {downloadPct != null && (
            <>
              <div className="label" style={{ fontSize: "0.75rem" }}>
                <span>{downloadPct}%</span>
                <span>
                  {formatBytes(pull.progress!.completed ?? 0)} /{" "}
                  {formatBytes(pull.progress!.total ?? 0)}
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${downloadPct}%` }} />
              </div>
            </>
          )}
          {pull.error && (
            <div style={{ color: "var(--danger)", marginTop: "0.5rem" }}>
              {pull.error}
            </div>
          )}
        </div>
      )}

      {models.length === 0 ? (
        <p className="empty">No local models. Pull one above.</p>
      ) : (
        <div className="table-wrap models-table-wrap">
          <table className="models-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Model</th>
                <th>Size</th>
                <th>Capabilities</th>
                <th>Modified</th>
                <th>Digest</th>
                <th>Format</th>
                <th>Family</th>
                <th>Families</th>
                <th>Params</th>
                <th>Quant</th>
                <th>Parent</th>
                <th>Context</th>
                <th>Embedding</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const d = m.details;
                const id = localModelId(m);
                const rowBusy = busy && (deleting === id || pull?.target === id);

                return (
                  <tr key={`${id}:${m.digest || m.modified_at}`}>
                    <td className="name">{id}</td>
                    <td className="mono-cell">{m.model}</td>
                    <td className="mono-cell">{formatBytes(m.size)}</td>
                    <td className="capabilities-cell">
                      {displayList(m.capabilities)}
                    </td>
                    <td className="mono-cell">
                      {new Date(m.modified_at).toLocaleString()}
                    </td>
                    <td className="mono-cell digest" title={m.digest}>
                      {shortDigest(m.digest)}
                    </td>
                    <td>{displayValue(d?.format)}</td>
                    <td>{displayValue(d?.family)}</td>
                    <td className="mono-cell">{displayList(d?.families ?? undefined)}</td>
                    <td>{displayValue(d?.parameter_size)}</td>
                    <td>{displayValue(d?.quantization_level)}</td>
                    <td className="mono-cell">{displayValue(d?.parent_model)}</td>
                    <td className="mono-cell">
                      {d?.context_length != null
                        ? d.context_length.toLocaleString()
                        : "—"}
                    </td>
                    <td className="mono-cell">
                      {d?.embedding_length != null
                        ? d.embedding_length.toLocaleString()
                        : "—"}
                    </td>
                    <td className="col-actions actions-cell">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => void runPull(id)}
                        disabled={rowBusy || busy}
                      >
                        Update
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => void runDelete(id)}
                        disabled={rowBusy || busy}
                      >
                        {deleting === id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
