export interface HfGgufFile {
  path: string;
  size: number;
  quant: string;
}

interface HfTreeEntry {
  type: string;
  path: string;
  size?: number;
  lfs?: { size: number };
}

const QUANT_SUFFIXES = [
  "Q8_0",
  "Q6_K",
  "Q5_K_M",
  "Q5_K_S",
  "Q5_1",
  "Q5_0",
  "Q4_K_M",
  "Q4_K_S",
  "Q4_1",
  "Q4_0",
  "Q3_K_L",
  "Q3_K_M",
  "Q3_K_S",
  "Q3_K",
  "Q2_K",
  "BF16",
  "F16",
  "FP16",
] as const;

function ggufQuantFromFilename(filename: string): string {
  const base = filename.replace(/\.gguf$/i, "");
  for (const quant of QUANT_SUFFIXES) {
    const suffix = `-${quant}`;
    if (base.toUpperCase().endsWith(suffix)) {
      return quant;
    }
    const alt = `_${quant}`;
    if (base.toUpperCase().endsWith(alt)) {
      return quant;
    }
  }
  return base;
}

function parseRepoId(repo: string): { user: string; name: string } {
  const normalized = repo.trim().replace(/^\/+|\/+$/g, "");
  const match = normalized.match(/^([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error('Invalid repo id — use "user/repo"');
  }
  return { user: match[1], name: match[2] };
}

export async function listGgufFiles(repo: string): Promise<HfGgufFile[]> {
  const { user, name } = parseRepoId(repo);
  const url = `https://huggingface.co/api/models/${user}/${name}/tree/main`;

  const headers: HeadersInit = { Accept: "application/json" };
  const token = process.env.HF_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text || `Hugging Face API error (${res.status}) for ${user}/${name}`,
    );
  }

  const entries = (await res.json()) as HfTreeEntry[];
  return entries
    .filter((e) => e.type === "file" && e.path.toLowerCase().endsWith(".gguf"))
    .map((e) => {
      const filename = e.path.split("/").pop() ?? e.path;
      const size = e.lfs?.size ?? e.size ?? 0;
      return {
        path: e.path,
        size,
        quant: ggufQuantFromFilename(filename),
      };
    })
    .sort((a, b) => a.size - b.size);
}
