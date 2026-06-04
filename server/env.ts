import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from server/ or dist/server/ until package.json is found. */
export function getProjectRoot(): string {
  let dir = moduleDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(moduleDir, "..");
}

let loaded = false;

export function loadProjectEnv(): void {
  if (loaded) return;
  const envPath = path.join(getProjectRoot(), ".env");
  dotenv.config({ path: envPath });
  loaded = true;
}

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
