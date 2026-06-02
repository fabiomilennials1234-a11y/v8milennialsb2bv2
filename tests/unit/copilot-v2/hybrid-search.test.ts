/**
 * Slice 7 — rank-fusion híbrido (Copilot v2, PURE)
 *
 * Funde resultados semânticos (pgvector) + keyword (ILIKE/tsquery) via
 * reciprocal-rank-fusion, deduplica por chunk id, aplica o threshold único,
 * e ordena por score fundido. Sem I/O.
 */
import { describe, it, expect } from 'vitest';
import { fuseHybridResults, type KnowledgeHit } from '../../../supabase/functions/_shared/copilot-v2/hybrid-search.ts';

const sem: KnowledgeHit[] = [
  { id: 1, content: 'Aço SAE 1045 — preço sob consulta', similarity: 0.82 },
  { id: 2, content: 'Catálogo geral de perfis', similarity: 0.58 },
  { id: 3, content: 'Política de frete', similarity: 0.40 },
];
const kw: KnowledgeHit[] = [
  { id: 4, content: 'SKU 1045 ficha técnica', similarity: 1 },
  { id: 1, content: 'Aço SAE 1045 — preço sob consulta', similarity: 1 },
];

describe('fuseHybridResults', () => {
  it('funde e deduplica por id, item presente nos dois sobe no rank', () => {
    const out = fuseHybridResults(sem, kw, { docThreshold: 0.55, limit: 5 });
    const ids = out.map((h) => h.id);
    expect(ids[0]).toBe(1);            // aparece em ambos -> maior RRF
    expect(new Set(ids).size).toBe(ids.length); // sem duplicata
    expect(ids).toContain(4);          // keyword-only entra
  });

  it('aplica o threshold no lado semântico (descarta abaixo do corte)', () => {
    const out = fuseHybridResults(sem, [], { docThreshold: 0.55, limit: 5 });
    expect(out.map((h) => h.id)).not.toContain(3); // 0.40 < 0.55
    expect(out.map((h) => h.id)).toContain(1);
  });

  it('respeita o limit', () => {
    const out = fuseHybridResults(sem, kw, { docThreshold: 0, limit: 2 });
    expect(out.length).toBe(2);
  });

  it('retorna [] quando ambos vazios (sem throw)', () => {
    expect(fuseHybridResults([], [], { docThreshold: 0.55, limit: 5 })).toEqual([]);
  });
});
