import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { avaliarFila, type BuscaDaFila, textoDaFila } from "./lista-fria-fila.ts";

const AGORA = Date.parse("2026-11-03T15:00:00Z");
const atras = (min: number) => new Date(AGORA - min * 60_000).toISOString();

const busca = (p: Partial<BuscaDaFila>): BuscaDaFila => ({
  id: crypto.randomUUID(),
  status: "na_fila",
  fonte: "maps",
  organization_id: "org-a",
  created_at: atras(1),
  heartbeat_at: null,
  worker_id: null,
  ...p,
});

Deno.test("fila vazia ou recém-criada: silêncio", () => {
  assertEquals(avaliarFila([], AGORA), []);
  assertEquals(avaliarFila([busca({ created_at: atras(4) })], AGORA), []);
});

Deno.test("esperando 5+ min sem nada andando: ninguém atende", () => {
  const r = avaliarFila([busca({ created_at: atras(6) }), busca({ created_at: atras(2) })], AGORA);
  assertEquals(r.length, 1);
  assertEquals(r[0].motivo, "ninguem_atende");
  assertEquals(r[0].buscas, 2);
  assertEquals(Math.round(r[0].minutos), 6);
});

Deno.test("REGRESSÃO: busca longa na frente NÃO é fila parada", () => {
  // Maps leva 6+ min; a segunda busca espera esse tempo com o worker saudável.
  const r = avaliarFila([
    busca({ status: "executando", heartbeat_at: atras(0.2), worker_id: "w1", created_at: atras(8) }),
    busca({ created_at: atras(7) }),
  ], AGORA);
  assertEquals(r, []);
});

Deno.test("worker andando mas fila esperando 30+ min: fila lenta", () => {
  const r = avaliarFila([
    busca({ status: "executando", heartbeat_at: atras(0.5), worker_id: "w1", created_at: atras(40) }),
    busca({ created_at: atras(31) }),
  ], AGORA);
  assertEquals(r.map((p) => p.motivo), ["fila_lenta"]);
});

Deno.test("executando sem sinal há 5+ min: worker sem sinal, com o id do worker", () => {
  const r = avaliarFila([busca({ status: "executando", heartbeat_at: atras(7), worker_id: "lista-fria-vps-1" })], AGORA);
  assertEquals(r.length, 1);
  assertEquals(r[0].motivo, "worker_sem_sinal");
  assertEquals(r[0].workers, ["lista-fria-vps-1"]);
  assertEquals(avaliarFila([busca({ status: "executando", heartbeat_at: atras(4.9) })], AGORA), []);
});

Deno.test("worker preso + fila esperando: os dois problemas, nada some", () => {
  const r = avaliarFila([
    busca({ status: "executando", heartbeat_at: atras(9), worker_id: "w1" }),
    busca({ created_at: atras(8) }),
  ], AGORA);
  assertEquals(r.map((p) => p.motivo).sort(), ["ninguem_atende", "worker_sem_sinal"]);
});

Deno.test("heartbeat ausente ou ilegível conta como sem sinal (na dúvida, avisa)", () => {
  const r = avaliarFila([busca({ status: "executando", heartbeat_at: null })], AGORA);
  assertEquals(r[0].motivo, "worker_sem_sinal");
  assertStringIncludes(textoDaFila(r, new Map()), "tempo desconhecido");
});

Deno.test("texto: nomeia a org, o motivo e o que fazer", () => {
  const r = avaliarFila([busca({ created_at: atras(12), organization_id: "o1" })], AGORA);
  const t = textoDaFila(r, new Map([["o1", "Café Jurerê"]]));
  assertStringIncludes(t, "Ninguém está atendendo");
  assertStringIncludes(t, "1 busca espera há 12 min");
  assertStringIncludes(t, "Café Jurerê");
  assertStringIncludes(t, "EasyPanel");
});
