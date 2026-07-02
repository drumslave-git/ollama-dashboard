import { useCallback, useEffect, useState } from "react";
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

export default function App() {
  const [version, setVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);

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
  const activeModels = running.data?.models ?? [];

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
          <a href="#models">Models library</a>
        </nav>
        <div className="sidebar-footer">
          <span className={`badge ${connected ? "ok" : "err"}`}>
            {connected
              ? version
                ? `Ollama ${version}`
                : "Connected"
              : "Disconnected"}
          </span>
        </div>
      </aside>

      <div className="app">
        <header className="header" id="overview">
          <div>
            <h2>Overview</h2>
            <p>Monitor active models, VRAM, and manage your library</p>
          </div>
        </header>

        {(running.error || local.error) && (
          <div className="error-banner">
            {running.error && <div>Running models: {running.error}</div>}
            {local.error && <div>Local models: {local.error}</div>}
            <div style={{ marginTop: "0.35rem", color: "var(--muted)" }}>
              Check that Ollama is running and OLLAMA_HOST is correct.
            </div>
          </div>
        )}

        <div className="grid grid-2">
          <section className="card" id="active-models">
            <h2>Active models</h2>
            {running.loading && activeModels.length === 0 ? (
              <p className="empty">Loading…</p>
            ) : (
              <ActiveModels
                models={activeModels}
                totalVram={gpu.data?.totalVram ?? null}
                onRefresh={refreshRunning}
              />
            )}
          </section>

          <section className="card" id="vram">
            <h2>VRAM</h2>
            <VramSummary
              models={activeModels}
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
      </div>
    </div>
  );
}
