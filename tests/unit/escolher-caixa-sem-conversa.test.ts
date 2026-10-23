/**
 * Chamado 52df972e — "Abrir conversa" de lead sem mensagens abria na caixa de
 * outra vendedora.
 *
 * Sem `?instance=` e sem histórico, o chat escolhia a 1ª caixa conectada da
 * lista em ordem alfabética. Admin enxerga todas as caixas da org, então
 * "Envase Carolini" vencia a caixa da própria Fernanda. A escolha agora segue a
 * mesma ordem do seletor "Iniciar conversa por" (#2329): preferida → minha
 * (e do responsável primeiro) → do responsável → conectada.
 */
import { describe, it, expect } from "vitest";
import { escolherCaixaSemConversa } from "@/modules/communication/lib/escolherCaixaSemConversa";
import { prioridadeDaCaixa } from "@/modules/communication/lib/prioridadeDaCaixa";

const caixa = (id: string, instance_name: string, status = "connected") => ({ id, instance_name, status });

// A org do Chamado: seis caixas conectadas, "Envase Carolini" é a 1ª alfabética.
const CAIXAS = [
  caixa("carolini", "Envase Carolini"),
  caixa("fernanda", "FERNANDA-TELEVENDAS-CONSULTORA"),
  caixa("fran", "Fran - Envase2"),
  caixa("isabelle", "ISABELLE"),
  caixa("rafaeli", "Rafaeli"),
  caixa("tatiane", "Tatiane"),
];

describe("escolherCaixaSemConversa", () => {
  it("a caixa preferida do usuário vence a 1ª alfabética", () => {
    expect(
      escolherCaixaSemConversa({ instances: CAIXAS, preferredInstanceId: "fernanda" }),
    ).toEqual({ caixa: CAIXAS[1], motivo: "sem-conversa:preferida" });
  });

  it("sem preferida, a caixa que é minha E do responsável vence as outras minhas", () => {
    const escolha = escolherCaixaSemConversa({
      instances: CAIXAS,
      minhasInstanceIds: ["fernanda", "isabelle", "rafaeli"],
      doResponsavelInstanceIds: ["rafaeli"],
    });
    expect(escolha?.caixa.id).toBe("rafaeli");
    expect(escolha?.motivo).toBe("sem-conversa:minha-e-do-responsavel");
  });

  it("sem preferida e sem interseção, a minha vem antes da do responsável", () => {
    const escolha = escolherCaixaSemConversa({
      instances: CAIXAS,
      minhasInstanceIds: ["tatiane"],
      doResponsavelInstanceIds: ["isabelle"],
    });
    expect(escolha).toEqual({ caixa: CAIXAS[5], motivo: "sem-conversa:minha" });
  });

  it("usuário sem caixa própria (master): a do responsável do lead lidera", () => {
    const escolha = escolherCaixaSemConversa({
      instances: CAIXAS,
      doResponsavelInstanceIds: ["isabelle"],
    });
    expect(escolha).toEqual({ caixa: CAIXAS[3], motivo: "sem-conversa:do-responsavel" });
  });

  it("preferida fora das caixas permitidas é ignorada", () => {
    const escolha = escolherCaixaSemConversa({
      instances: CAIXAS,
      preferredInstanceId: "caixa-de-outra-org",
      minhasInstanceIds: ["tatiane"],
    });
    expect(escolha?.caixa.id).toBe("tatiane");
  });

  it("sem sinal nenhum, cai na 1ª conectada — não numa caixa caída", () => {
    const escolha = escolherCaixaSemConversa({
      instances: [caixa("a", "Alfa", "disconnected"), caixa("b", "Beta")],
    });
    expect(escolha).toEqual({ caixa: { id: "b", instance_name: "Beta", status: "connected" }, motivo: "sem-conversa:conectada" });
  });

  it("todas caídas: devolve a primeira, para a conversa ainda abrir", () => {
    const escolha = escolherCaixaSemConversa({
      instances: [caixa("b", "Beta", "disconnected"), caixa("a", "Alfa", "disconnected")],
    });
    expect(escolha).toEqual({ caixa: { id: "a", instance_name: "Alfa", status: "disconnected" }, motivo: "sem-conversa:primeira" });
  });

  it("a preferência vence o status, como no seletor", () => {
    const escolha = escolherCaixaSemConversa({
      instances: [caixa("a", "Alfa"), caixa("b", "Beta", "disconnected")],
      preferredInstanceId: "b",
    });
    expect(escolha?.caixa.id).toBe("b");
  });

  it("nunca devolve id fora da lista, por mais que os sinais apontem para fora", () => {
    const ids = new Set(CAIXAS.map((c) => c.id));
    const escolha = escolherCaixaSemConversa({
      instances: CAIXAS,
      preferredInstanceId: "fora",
      minhasInstanceIds: ["fora-1"],
      doResponsavelInstanceIds: ["fora-2"],
    });
    expect(escolha && ids.has(escolha.caixa.id)).toBe(true);
  });

  it("lista vazia devolve null", () => {
    expect(escolherCaixaSemConversa({ instances: [] })).toBeNull();
  });
});

describe("prioridadeDaCaixa — a ordem que o seletor e o chat compartilham", () => {
  it("preferida 0 · minha e do responsável 1 · minha 2 · do responsável 3 · demais 4", () => {
    const prioridade = prioridadeDaCaixa({
      preferredInstanceId: "p",
      minhasInstanceIds: ["p", "mr", "m"],
      doResponsavelInstanceIds: ["mr", "r"],
    });
    expect(["p", "mr", "m", "r", "x"].map(prioridade)).toEqual([0, 1, 2, 3, 4]);
  });
});
