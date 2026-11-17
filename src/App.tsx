import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchGpuStats,
  fetchLocalModels,
  fetchRunningModels,
  fetchVersion,
} from "./api/ollama";
import { ActiveModels } from "./components/ActiveModels";
import { ModelsPanel } from "./components/ModelsPanel";
import { VramSummary } from "./components/VramSummary";
import { usePolling } from "./hooks/usePolling";
import { modelColors } from "./lib/memoryMap";

export default function App() {
  const [version, setVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [focusModel, setFocusModel] = useState<string | null>(null);

  const running = usePolling(fetchRunningModels, 2000);
  const gpu = usePolling(fetchGpuStats, 2000);
  const local = usePolling(fetchLocalModels, 10_000);

  const refreshLocal = useCallback(() => {
    void local.refresh();
  }, [local]);

  const refreshRunning = useCallback(() => {
    void running.refresh();
    void gpu.refresh();
  }, [running, gpu]);

  useEffect(() => {
    fetchVersion()
      .then((v) => {
        setVersion(v.version);
        setVersionError(false);
      })
      .catch(() => {
        setVersion(null);
        setVersionError(true);
      });
  }, []);

  const connected = !running.error && !versionError;
  const activeModels = useMemo(
    () => running.data?.models ?? [],
    [running.data],
  );
  const colors = useMemo(() => modelColors(activeModels), [activeModels]);
  const localCount = local.data?.models.length ?? null;

  const summary =
    running.data && localCount != null
      ? `${activeModels.length} ${activeModels.length === 1 ? "model" : "models"} loaded · ${localCount} downloaded`
      : null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>Ollama Dashboard</h1>
          <p>Monitor and manage models</p>
        </div>
        <nav className="sidebar-nav">
          <a href="#overview">Overview</a>
          <a href="#active-models">Active models</a>
          <a href="#vram">VRAM</a>
          <a href="#models">Models</a>
        </nav>
        <div className="sidebar-footer">
          <span className={`status ${connected ? "ok" : "err"}`}>
            <span className="status-led" aria-hidden />
            {connected
              ? version
                ? `Ollama ${version}`
                : "Connected"
              : "Disconnected"}
          </span>
        </div>
      </aside>

      <main className="app">
        <header className="header" id="overview">
          <h2>Overview</h2>
          {summary && <p>{summary}</p>}
        </header>

        {(running.error || local.error) && (
          <div className="error-banner" role="alert">
            {running.error && <div>Running models: {running.error}</div>}
            {local.error && <div>Local models: {local.error}</div>}
            <div className="error-hint">
              Check that Ollama is running and OLLAMA_HOST is correct
            </div>
          </div>
        )}

        <div className="grid grid-split">
          <section className="card" id="active-models">
            <div className="card-header">
              <h2 className="card-title">Active models</h2>
            </div>
            {running.loading && activeModels.length === 0 ? (
              <p className="empty">Loading…</p>
            ) : (
              <ActiveModels
                models={activeModels}
                totalVram={gpu.data?.totalVram ?? null}
                colors={colors}
                onFocusModel={setFocusModel}
                onRefresh={refreshRunning}
              />
            )}
          </section>

          <section className="card card-vram" id="vram">
            <VramSummary
              models={activeModels}
              colors={colors}
              focusModel={focusModel}
              gpu={gpu.data}
              gpuError={gpu.error}
              gpuLoading={gpu.loading}
            />
          </section>
        </div>

        <div className="models-section" id="models">
          <ModelsPanel
            models={local.data?.models ?? []}
            onRefresh={refreshLocal}
          />
        </div>
      </main>
    </div>
  );
}
