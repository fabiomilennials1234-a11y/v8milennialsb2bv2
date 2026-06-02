/**
 * hybrid-search — Copilot v2 rank-fusion de busca de conhecimento (Slice 7, PURE).
 *
 * Funde candidatos semânticos (pgvector) + keyword (ILIKE/tsquery) via
 * reciprocal-rank-fusion (RRF, k=60). Aplica o threshold de doc no lado
 * semântico (keyword já é match exato). Deduplica por id, ordena por score
 * fundido, corta no limit. Sem I/O — testável puro.
 */
export interface KnowledgeHit {
  id: number;
  content: string;
  /** similaridade vetorial [0,1] no lado semântico; 1 no lado keyword. */
  similarity: number;
}

export interface FuseOpts {
  docThreshold: number;
  limit: number;
  /** constante RRF (suaviza o peso por rank). */
  rrfK?: number;
}

export function fuseHybridResults(
  semantic: KnowledgeHit[],
  keyword: KnowledgeHit[],
  opts: FuseOpts,
): KnowledgeHit[] {
  const k = opts.rrfK ?? 60;
  const scores = new Map<number, { hit: KnowledgeHit; score: number }>();

  const add = (list: KnowledgeHit[], gate: (h: KnowledgeHit) => boolean) => {
    list.filter(gate).forEach((hit, rank) => {
      const prev = scores.get(hit.id);
      const inc = 1 / (k + rank + 1);
      if (prev) prev.score += inc;
      else scores.set(hit.id, { hit, score: inc });
    });
  };

  // Semântico passa pelo threshold; keyword é match exato (não filtra por similaridade).
  add([...semantic].sort((a, b) => b.similarity - a.similarity), (h) => h.similarity >= opts.docThreshold);
  add(keyword, () => true);

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit)
    .map((s) => s.hit);
}
