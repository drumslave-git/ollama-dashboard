import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envNumber, loadProjectEnv } from "./env.js";
import { getGpuStats } from "./gpu.js";
import { listGgufFiles } from "./huggingface.js";
import { ollamaProxy } from "./ollama-proxy.js";

loadProjectEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = envNumber("PORT", 3000);
const PROXY_PORT = envNumber("PROXY_PORT", 3001);
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const isProduction = process.env.NODE_ENV === "production";
const clientDir = path.join(__dirname, "../client");
const hasBuild = fs.existsSync(path.join(clientDir, "index.html"));

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

app.get("/api/dashboard/huggingface/files", async (req, res) => {
  const repo = typeof req.query.repo === "string" ? req.query.repo.trim() : "";
  if (!repo) {
    res.status(400).json({ error: 'Missing "repo" query parameter' });
    return;
  }

  try {
    const files = await listGgufFiles(repo);
    res.json(files);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hugging Face lookup failed";
    res.status(502).json({ error: message });
  }
});

app.use(ollamaProxy(OLLAMA_HOST));

if (isProduction) {
  if (!hasBuild) {
    console.error("Missing dist/client — run npm run build first.");
    process.exit(1);
  }
  app.use(express.static(clientDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

const listenPort = isProduction ? PORT : PROXY_PORT;

app.listen(listenPort, "0.0.0.0", () => {
  if (isProduction) {
    console.log(`Ollama Dashboard at http://localhost:${PORT}`);
  } else {
    console.log(`API proxy at http://localhost:${PROXY_PORT}`);
  }
  console.log(`Proxying Ollama API at ${OLLAMA_HOST}`);
});
