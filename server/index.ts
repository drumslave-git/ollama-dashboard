import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envNumber, loadProjectEnv } from "./env.js";
import { getGpuStats } from "./gpu.js";

loadProjectEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PORT = envNumber("PORT", 3000);
const PROXY_PORT = envNumber("PROXY_PORT", 3001);
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

const clientDir = path.join(__dirname, "../client");
const serveClient = fs.existsSync(path.join(clientDir, "index.html"));
const listenPort = serveClient ? DASHBOARD_PORT : PROXY_PORT;

const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true, ollamaHost: OLLAMA_HOST });
});

app.get("/api/dashboard/gpu", async (_req, res) => {
  try {
    const stats = await getGpuStats(OLLAMA_HOST);
    res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : "GPU stats failed";
    res.status(500).json({ error: message });
  }
});

// Mounting at "/api" strips that prefix; Ollama expects /api/ps, not /ps.
app.use(
  createProxyMiddleware({
    target: OLLAMA_HOST,
    changeOrigin: true,
    pathFilter: (pathname) =>
      pathname.startsWith("/api") && !pathname.startsWith("/api/dashboard"),
    proxyTimeout: 0,
    timeout: 0,
  }),
);

if (serveClient) {
  app.use(express.static(clientDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

app.listen(listenPort, () => {
  if (serveClient) {
    console.log(`Ollama Dashboard at http://localhost:${DASHBOARD_PORT}`);
  } else {
    console.log(`Ollama API proxy at http://localhost:${PROXY_PORT}`);
  }
  console.log(`Proxying Ollama API at ${OLLAMA_HOST}`);
});
