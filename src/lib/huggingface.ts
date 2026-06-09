/** Ollama pull name for a Hugging Face GGUF repo (optional quant tag). */
export function buildOllamaHfPullName(repo: string, quant?: string): string {
  const base = `hf.co/${repo}`;
  return quant ? `${base}:${quant}` : base;
}

export interface HfRepoRef {
  repo: string;
  quant?: string;
}

/**
 * Parse Hugging Face URLs, hf.co refs, or user/repo paths into a repo id.
 * Returns null when the input looks like a normal Ollama registry tag.
 */
export function parseHuggingFaceInput(input: string): HfRepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hfUrl = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co|hf\.co)\/([^/?#]+)\/([^/?#]+)/i,
  );
  if (hfUrl) {
    const [, user, repo] = hfUrl;
    const quantMatch = repo.match(/^(.+):([^/]+)$/);
    if (quantMatch) {
      return { repo: `${user}/${quantMatch[1]}`, quant: quantMatch[2] };
    }
    return { repo: `${user}/${repo}` };
  }

  const hfCo = trimmed.match(/^hf\.co\/([^/]+)\/([^:]+)(?::(.+))?$/i);
  if (hfCo) {
    return { repo: `${hfCo[1]}/${hfCo[2]}`, quant: hfCo[3] };
  }

  const slash = trimmed.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?::(.+))?$/);
  if (slash && !trimmed.includes(" ")) {
    const [, user, repo, quant] = slash;
    if (!/^(latest|main|master)$/i.test(repo)) {
      return { repo: `${user}/${repo}`, quant };
    }
  }

  return null;
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

/** Normalize model refs for comparison (HF URLs, hf.co paths, quant case). */
export function normalizeOllamaModelRef(ref: string): string {
  return ref
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^huggingface\.co\//i, "hf.co/")
    .toLowerCase();
}

function splitModelTag(ref: string): [string, string | undefined] {
  const idx = ref.lastIndexOf(":");
  if (idx <= 0) return [ref, undefined];
  const base = ref.slice(0, idx);
  const tag = ref.slice(idx + 1);
  if (base.includes("/") || base.startsWith("hf.co")) {
    return [base, tag];
  }
  return [ref, undefined];
}

/** Whether a local model entry matches a pull ref (handles HF quant casing). */
export function modelRefMatchesLocal(
  pulledRef: string,
  localId: string,
): boolean {
  const a = normalizeOllamaModelRef(pulledRef);
  const b = normalizeOllamaModelRef(localId);
  if (a === b) return true;
  const [aBase, aTag] = splitModelTag(a);
  const [bBase, bTag] = splitModelTag(b);
  return aBase === bBase && (!aTag || !bTag || aTag === bTag);
}

/** Extract the Ollama quant tag from a GGUF filename. */
export function ggufQuantFromFilename(filename: string): string {
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
