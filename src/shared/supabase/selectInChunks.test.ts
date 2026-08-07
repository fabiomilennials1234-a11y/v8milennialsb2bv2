/**
 * Testes do selectInChunks. Além do comportamento, travam os NÚMEROS: os tetos
 * aqui saíram de medição contra o PROD e mudá-los sem medir de novo reabre o
 * incidente da Goletric Pinheiros (2026-07-31).
 */
import { describe, it, expect, vi } from "vitest";
import {
  selectInChunks,
  chunkIds,
  IN_CHUNK_SIZE,
  IN_CHUNK_SIZE_FANOUT,
  URL_SAFE_MAX_IDS,
} from "./selectInChunks";

const ids = (n: number, prefix = "id") =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

/** `run` que devolve uma linha por id do lote e registra os lotes recebidos. */
function spyRun() {
  const batches: string[][] = [];
  const run = vi.fn(async (chunk: string[]) => {
    batches.push(chunk);
    return { data: chunk.map((id) => ({ id })), error: null };
  });
  return { run, batches };
}

describe("chunkIds", () => {
  it("recusa size inválido em vez de fatiar errado", () => {
    expect(() => chunkIds(["a"], 0)).toThrow();
    expect(() => chunkIds(["a"], -1)).toThrow();
    expect(() => chunkIds(["a"], 1.5)).toThrow();
  });

  it.each([
    [0, 0],
    [1, 1],
    [199, 1],
    [200, 1],
    [201, 2],
    [1000, 5],
  ])("%i ids viram %i lotes de 200", (n, expected) => {
    expect(chunkIds(ids(n), 200)).toHaveLength(expected);
  });

  it("preserva todos os elementos, sem perder nem duplicar", () => {
    const source = ids(1000);
    expect(chunkIds(source, 200).flat()).toEqual(source);
  });
});

describe("selectInChunks", () => {
  it("lista vazia não dispara requisição nenhuma", async () => {
    const { run } = spyRun();
    await expect(selectInChunks([], run)).resolves.toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([1, 641, 642, 1000, 5000])(
    "com %i ids, nenhum lote passa do size — é isto que impede o 400 do gateway",
    async (n) => {
      const { run, batches } = spyRun();
      await selectInChunks(ids(n), run, IN_CHUNK_SIZE);
      expect(batches.length).toBeGreaterThan(0);
      for (const b of batches) expect(b.length).toBeLessThanOrEqual(IN_CHUNK_SIZE);
    },
  );

  it("dedupa antes de fatiar", async () => {
    const distinct = ids(400);
    const withDupes = [...distinct, ...distinct, ...distinct.slice(0, 200)];
    const { run, batches } = spyRun();

    const rows = await selectInChunks(withDupes, run, IN_CHUNK_SIZE);

    expect(batches).toHaveLength(2); // 400 distintos / 200, não 1000/200
    expect(batches.flat().sort()).toEqual([...distinct].sort());
    expect(rows).toHaveLength(400);
  });

  it("concatena os lotes na ordem, sem perder linha", async () => {
    const run = vi.fn(async (chunk: string[]) => ({
      data: [{ id: chunk[0] }],
      error: null,
    }));
    const rows = await selectInChunks(ids(5), run, 2);
    expect(rows).toEqual([{ id: "id-0" }, { id: "id-2" }, { id: "id-4" }]);
  });

  it("trata data null como lote vazio, não como erro", async () => {
    const run = vi.fn(async () => ({ data: null, error: null }));
    await expect(selectInChunks(ids(3), run, 2)).resolves.toEqual([]);
  });

  it("lança no primeiro erro e NÃO devolve resultado parcial", async () => {
    // Resultado parcial é pior que erro: um meio-mapa de funis filtraria errado
    // sem ninguém notar — exatamente a falha silenciosa que causou o incidente.
    const run = vi.fn(async (chunk: string[]) =>
      chunk[0] === "id-2"
        ? { data: null, error: { message: "Bad Request" } }
        : { data: chunk.map((id) => ({ id })), error: null },
    );
    await expect(selectInChunks(ids(6), run, 2)).rejects.toEqual({ message: "Bad Request" });
  });
});

describe("orçamento medido em PROD", () => {
  it("o lote padrão fica com pelo menos 3× de margem sob o teto de URL", () => {
    // Medido 2026-07-31: 641 uuids passam (25.176 B), 642 dão 400 Bad Request.
    // Quem "otimizar" o chunk pra perto do teto vê este teste vermelho ANTES do
    // cliente ver a lista vazia.
    expect(IN_CHUNK_SIZE * 3).toBeLessThanOrEqual(URL_SAFE_MAX_IDS);
    expect(IN_CHUNK_SIZE_FANOUT * 3).toBeLessThanOrEqual(URL_SAFE_MAX_IDS);
  });

  it("o lote de fan-out cabe no teto de linhas por resposta", () => {
    // Fan-out medido em PROD: até 7 tags/lead (o pior dos três call sites).
    const PIOR_FANOUT_MEDIDO = 7;
    expect(IN_CHUNK_SIZE_FANOUT * PIOR_FANOUT_MEDIDO).toBeLessThan(1000);
  });
});
