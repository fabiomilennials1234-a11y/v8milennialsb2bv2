/**
 * Board legado (`usePipeWhatsapp`) — respostas de gravação fora de ordem (CX ①,
 * volta 3 — F3-b). `useMutation` sem fila: dois moves da mesma entrada podem
 * assentar em qualquer ordem. Move mais novo concluído supera os anteriores
 * abertos; reverter um superado não mexe em posição nem contagem.
 */
import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { optimisticMovePipelineEntry as mover, rollbackPipelineEntryMove as reverter, concluirMovePipelineEntry as concluir } from "@/modules/pipelines/lib/optimistic-move";

const B = "whatsapp";
const k = (s: string) => ["pipeline-page", B, s, "org-1", "f"];
const ck = ["pipeline-stage-counts", B, "org-1", "{}"];
const COLS = ["novo", "contato", "proposta"];
function semear() {
  const qc = new QueryClient();
  qc.setQueryData(k("novo"), { pages: [[{ id: "a", stage_key: "novo", status: "novo" }, { id: "b", stage_key: "novo", status: "novo" }, { id: "c", stage_key: "novo", status: "novo" }]], pageParams: [null] });
  qc.setQueryData(k("contato"), { pages: [[]], pageParams: [null] });
  qc.setQueryData(k("proposta"), { pages: [[]], pageParams: [null] });
  qc.setQueryData(ck, { novo: 3, contato: 0, proposta: 0 });
  return qc;
}
const ids = (qc: QueryClient, s: string) => (qc.getQueryData(k(s)) as { pages: Array<Array<{ id: string }>> }).pages.flat().map((e) => e.id);
const foto = (qc: QueryClient) => Object.fromEntries([...COLS.map((c) => [c, ids(qc, c)]), ["cnt", qc.getQueryData(ck)]]);
function coerente(qc: QueryClient) {
  const f = foto(qc) as Record<string, unknown>;
  const todos = COLS.flatMap((c) => ids(qc, c));
  expect(new Set(todos).size).toBe(todos.length);
  expect(todos.sort()).toEqual(["a", "b", "c"]);
  const cnt = qc.getQueryData(ck) as Record<string, number>;
  for (const c of COLS) expect(cnt[c]).toBe((f[c] as string[]).length);
}

describe("optimistic-move — legado, gravações fora de ordem (F3-b)", () => {
  it("mesma entrada: A(novo→contato) e B(→proposta); B sucesso ANTES; A erro depois → fica em proposta", () => {
    const qc = semear();
    const sA = mover(qc, { boardKey: B, id: "a", toStage: "contato" });
    const sB = mover(qc, { boardKey: B, id: "a", toStage: "proposta" });
    concluir(qc, sB);
    reverter(qc, sA);
    expect(ids(qc, "proposta")).toEqual(["a"]);
    coerente(qc);
  });
  it("mesma entrada: A sucesso, B erro → volta para contato (destino de A)", () => {
    const qc = semear();
    const sA = mover(qc, { boardKey: B, id: "a", toStage: "contato" });
    const sB = mover(qc, { boardKey: B, id: "a", toStage: "proposta" });
    concluir(qc, sA);
    reverter(qc, sB);
    expect(ids(qc, "contato")).toEqual(["a"]);
    coerente(qc);
  });
  it("mesma entrada: B erro ANTES de A erro → volta a novo na posição 0", () => {
    const qc = semear();
    const sA = mover(qc, { boardKey: B, id: "a", toStage: "contato" });
    const sB = mover(qc, { boardKey: B, id: "a", toStage: "proposta" });
    reverter(qc, sB);
    reverter(qc, sA);
    expect(ids(qc, "novo")).toEqual(["a", "b", "c"]);
    coerente(qc);
  });
  it("mesma entrada: A erro ANTES de B (B ainda em voo), depois B erro → novo", () => {
    const qc = semear();
    const sA = mover(qc, { boardKey: B, id: "a", toStage: "contato" });
    const sB = mover(qc, { boardKey: B, id: "a", toStage: "proposta" });
    reverter(qc, sA);
    const meio = foto(qc);
    reverter(qc, sB);
    expect((meio.proposta as string[])).toEqual(["a"]);
    expect(ids(qc, "novo")).toEqual(["a", "b", "c"]);
    coerente(qc);
  });
  it("mesma entrada 3×, todas as 6 ordens de assentamento × sucesso/erro (exaustivo)", () => {
    const destinos = ["contato", "proposta", "contato"];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    let n = 0;
    for (const p of perms) for (let m = 0; m < 8; m++) {
      const qc = semear();
      const snaps = destinos.map((d) => mover(qc, { boardKey: B, id: "a", toStage: d }));
      const ok = [0, 1, 2].map((i) => ((m >> i) & 1) === 1);
      for (const i of p) (ok[i] ? concluir : reverter)(qc, snaps[i]);
      // Servidor: o último POST bem-sucedido (por ordem de envio) vence? Não sabemos a ordem de gravação no servidor;
      // invariante mínima: coerência + card onde o último sucesso por ordem de ENVIO o pôs, ou novo se nenhum.
      const ultimoOk = [2, 1, 0].find((i) => ok[i]);
      const esperado = ultimoOk === undefined ? "novo" : destinos[ultimoOk];
      expect({ p, ok, onde: COLS.find((c) => ids(qc, c).includes("a")) }).toEqual({ p, ok, onde: esperado });
      coerente(qc);
      n++;
    }
    expect(n).toBe(48);
  });
  it("entradas diferentes intercaladas (a,b,c) com erros cruzados fora de ordem", () => {
    const qc = semear();
    const sa = mover(qc, { boardKey: B, id: "a", toStage: "contato" });
    const sb = mover(qc, { boardKey: B, id: "b", toStage: "contato" });
    const sc = mover(qc, { boardKey: B, id: "c", toStage: "proposta" });
    reverter(qc, sb); concluir(qc, sc); reverter(qc, sa);
    expect(ids(qc, "novo")).toEqual(["a", "b"]);
    expect(ids(qc, "proposta")).toEqual(["c"]);
    coerente(qc);
  });
});
