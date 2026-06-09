export interface HfGgufFile {
  path: string;
  size: number;
  quant: string;
}

export async function fetchHfGgufFiles(repo: string): Promise<HfGgufFile[]> {
  const params = new URLSearchParams({ repo });
  const res = await fetch(`/api/dashboard/huggingface/files?${params}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Lookup failed (${res.status})`);
  }
  return res.json() as Promise<HfGgufFile[]>;
}
