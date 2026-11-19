import { useEffect, useState } from "react";
import { fetchModelEstimates, localModelId } from "../api/ollama";
import type { LocalModel, ModelEstimates } from "../types/ollama";

/** Memory estimates for the downloaded models, refetched when the set changes. */
export function useModelEstimates(models: LocalModel[]): ModelEstimates | null {
  const [estimates, setEstimates] = useState<ModelEstimates | null>(null);
  const key = models.map((m) => `${localModelId(m)}@${m.digest}`).join("\n");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetchModelEstimates()
      .then((result) => {
        if (!cancelled) setEstimates(result);
      })
      .catch(() => {
        // Estimates are an extra; the table stays usable without them.
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return estimates;
}
