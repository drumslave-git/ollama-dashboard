# Ollama Dashboard

Web UI to monitor and manage a remote or local [Ollama](https://ollama.com) instance.

## Features

- **Active models** — models loaded in memory, with VRAM per model
- **VRAM usage** — used / total / available (percentage bar when `GPU_VRAM_TOTAL_GB` is set)
- **Models library**
  - Pull by tag
  - List downloaded models (full metadata from Ollama)
  - Update a single model (re-pull)
  - Bulk update (re-pull all)
  - Delete with confirmation

## Stack

- React + TypeScript + Vite (frontend)
- Express (API proxy + production static server)

## Requirements

- Node.js 20+
- A running Ollama server reachable from this app

## Configuration

Copy `.env.example` to `.env`:

| Variable | Description |
|----------|-------------|
| `PORT` | Dashboard URL port. In dev, Vite listens here. In production/Docker, the app listens here. |
| `OLLAMA_HOST` | Base URL of Ollama (e.g. `http://localhost:11434` or `https://ollama.example.com`) |
| `PROXY_PORT` | Dev only. Internal API proxy port (default `3001`). Not exposed in Docker. |
| `GPU_VRAM_TOTAL_GB` | Total GPU VRAM in GiB. Required for the VRAM usage percentage bar. |

Example:

```env
PORT=4000
OLLAMA_HOST=https://ollama.example.com
GPU_VRAM_TOTAL_GB=48
```

## Development

```bash
npm install
npm run dev
```

This starts two processes via [concurrently](https://www.npmjs.com/package/concurrently):

| Process | Port | Role |
|---------|------|------|
| **client** (Vite) | `PORT` | Dashboard UI — open this in the browser |
| **server** | `PROXY_PORT` | Proxies `/api/*` to Ollama; serves `/api/dashboard/gpu` |

Open **http://localhost:`PORT`** (e.g. http://localhost:4000 if `PORT=4000`).

## Production

```bash
npm run build
npm run start
```

Serves the built UI and API on `PORT` in a single process.

## Docker

Only the dashboard port is published. The container listens on `3000` internally; map it with `PORT` in compose or `docker run -p`.

```bash
docker compose up --build
```

With a remote Ollama host:

```bash
OLLAMA_HOST=https://ollama.example.com GPU_VRAM_TOTAL_GB=48 docker compose up --build
```

Ollama on the host machine (Docker Desktop):

```env
OLLAMA_HOST=http://host.docker.internal:11434
```

Build image only:

```bash
docker build -t ollama-dashboard .
docker run --rm -p 3000:3000 \
  -e OLLAMA_HOST=http://host.docker.internal:11434 \
  -e GPU_VRAM_TOTAL_GB=24 \
  ollama-dashboard
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite + API proxy (development) |
| `npm run build` | Compile server and build client |
| `npm run start` | Run production server |
| `npm run preview` | Build and start locally |
| `npm run typecheck` | TypeScript check |

## Health check

```bash
curl http://localhost:3000/health
```

Returns `{ "ok": true, "ollamaHost": "..." }`.
