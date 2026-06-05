import { useCallback, useState } from "react";
import { deleteModel, pullModel } from "../api/ollama";
import {
  displayList,
  displayValue,
  formatBytes,
  pullStatusLabel,
  shortDigest,
} from "../lib/format";
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
  const [pull, setPull] = useState<PullState | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const busy = pull !== null || bulkRunning || deleting !== null;

  const runPull = useCallback(
    async (name: string) => {
      setPull({ target: name, progress: null, error: null });
      try {
        await pullModel(name, (progress) => {
          setPull((prev) =>
            prev?.target === name ? { ...prev, progress } : prev,
          );
        });
        onRefresh();
      } catch (err) {
        setPull({
          target: name,
          progress: null,
          error: err instanceof Error ? err.message : "Pull failed",
        });
      } finally {
        setTimeout(() => setPull(null), 2500);
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

  const handlePull = () => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    void runPull(trimmed);
    setTag("");
  };

  const handleBulkUpdate = async () => {
    if (models.length === 0) return;
    setBulkRunning(true);
    for (const m of models) {
      setPull({ target: m.name, progress: { status: "queued" }, error: null });
      try {
        await pullModel(m.name, (progress) => {
          setPull({ target: m.name, progress, error: null });
        });
      } catch (err) {
        setPull({
          target: m.name,
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
          placeholder="Pull model by tag (e.g. llama3.2:latest)"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handlePull()}
          disabled={busy}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={handlePull}
          disabled={busy || !tag.trim()}
        >
          Pull
        </button>
      </div>

      <div className="actions-row">
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          {models.length} downloaded
        </span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void handleBulkUpdate()}
          disabled={busy || models.length === 0}
        >
          Bulk update (re-pull all)
        </button>
      </div>

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
                const rowBusy = busy && (deleting === m.name || pull?.target === m.name);

                return (
                  <tr key={m.digest}>
                    <td className="name">{m.name}</td>
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
                        onClick={() => void runPull(m.name)}
                        disabled={rowBusy || busy}
                      >
                        Update
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => void runDelete(m.name)}
                        disabled={rowBusy || busy}
                      >
                        {deleting === m.name ? "Deleting…" : "Delete"}
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
