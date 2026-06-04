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

export function shortDigest(digest: string, head = 12, tail = 8): string {
  if (digest.length <= head + tail + 1) return digest;
  return `${digest.slice(0, head)}…${digest.slice(-tail)}`;
}
