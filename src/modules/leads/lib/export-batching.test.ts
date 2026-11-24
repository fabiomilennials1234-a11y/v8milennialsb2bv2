import { describe, expect, it } from "vitest";
import { chunk, EXPORT_ID_BATCH_SIZE, fetchByIdBatches } from "./export-batching";

const POSTGREST_MAX_ROWS = 1000;
/** ~37 chars por uuid na URL; gateway rejeita `.in()` acima disso. */
const MAX_IDS_PER_IN = 300;

/** Simula o PostgREST: teto de linhas por resposta + URL com limite. */
function fakeTable(rows: Array<{ id: string }>) {
  const calls: Array<{ batch: number; from: number; to: number }> = [];
  const fetchPage = async (batch: string[], from: number, to: number) => {
    calls.push({ batch: batch.length, from, to });
    if (batch.length > MAX_IDS_PER_IN) return { data: null, error: { message: "URI too long" } };
    const wanted = new Set(batch);
    const matching = rows.filter((r) => wanted.has(r.id));
    const size = Math.min(to - from + 1, POSTGREST_MAX_ROWS);
    return { data: matching.slice(from, from + size), error: null };
  };
  return { fetchPage, calls };
}

describe("chunk", () => {
  it("divide em lotes e preserva o resto", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("fetchByIdBatches", () => {
  it("lê os 2.958 leads de uma etapa grande sem estourar a URL", async () => {
    const ids = Array.from({ length: 2958 }, (_, i) => `lead-${i}`);
    const { fetchPage, calls } = fakeTable(ids.map((id) => ({ id })));

    const rows = await fetchByIdBatches(ids, fetchPage);

    expect(rows).toHaveLength(2958);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2958);
    expect(Math.max(...calls.map((c) => c.batch))).toBeLessThanOrEqual(EXPORT_ID_BATCH_SIZE);
  });

  it("pagina quando um lote devolve mais linhas que o teto do servidor", async () => {
    // 10 ids com 250 linhas cada (ex.: entries de vários funis) → 2.500 linhas no lote.
    const ids = Array.from({ length: 10 }, (_, i) => `lead-${i}`);
    const rows = ids.flatMap((id) => Array.from({ length: 250 }, () => ({ id })));
    const { fetchPage } = fakeTable(rows);

    const out = await fetchByIdBatches(ids, fetchPage);

    expect(out).toHaveLength(2500);
  });

  it("propaga o erro real do servidor", async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `lead-${i}`);
    const { fetchPage } = fakeTable([]);

    await expect(fetchByIdBatches(ids, fetchPage, 400)).rejects.toThrow("URI too long");
  });

  it("sem ids não consulta nada", async () => {
    const { fetchPage, calls } = fakeTable([]);
    expect(await fetchByIdBatches([], fetchPage)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
