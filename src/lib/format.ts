import type { PullProgress } from "../types/ollama";

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRelativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return diff < 0 ? `${mins}m ago` : `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return diff < 0 ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return diff < 0 ? `${days}d ago` : `in ${days}d`;
}

/** Used VRAM as a percentage of total GPU VRAM (0–100). */
export function vramUsedPercent(used: number, total: number): number {
  if (total <= 0 || used <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

export function displayValue(
  value: string | number | null | undefined,
): string {
  if (value === undefined || value === null || value === "") return "—";
  return String(value);
}

export function displayList(items: string[] | null | undefined): string {
  if (!items?.length) return "—";
  return items.join(", ");
}

export function pullStatusLabel(progress: PullProgress | null): string | null {
  if (!progress) return null;
  const status = progress.status?.trim();
  if (status) return status;
  if (progress.total != null && progress.completed != null) return "downloading";
  return "preparing…";
}

/** First 12 hex characters, the same ID `ollama list` shows. */
export function shortDigest(digest: string, length = 12): string {
  return digest.slice(0, length);
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
}

const CAPABILITY_ORDER = [
  "completion",
  "embedding",
  "insert",
  "tools",
  "thinking",
  "vision",
  "audio",
];

/** Capabilities in one fixed order, so rows compare at a glance. */
export function sortCapabilities(items: string[] | null | undefined): string[] {
  if (!items?.length) return [];
  const rank = (c: string) => {
    const i = CAPABILITY_ORDER.indexOf(c);
    return i === -1 ? CAPABILITY_ORDER.length : i;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Split a model ref into its namespace (`hf.co/user/`) and the rest. */
export function splitModelRef(ref: string): { prefix: string; rest: string } {
  const i = ref.lastIndexOf("/");
  if (i === -1) return { prefix: "", rest: ref };
  return { prefix: ref.slice(0, i + 1), rest: ref.slice(i + 1) };
}
