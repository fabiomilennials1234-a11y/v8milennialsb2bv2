import { describe, it, expect } from "vitest";
import { nomeCurtoDoResponsavel, resolverResponsavelDaLinha } from "./responsavelDaLinha";

describe("nomeCurtoDoResponsavel", () => {
  it("primeiro nome + inicial do ÚLTIMO sobrenome", () => {
    expect(nomeCurtoDoResponsavel("Maria da Silva Souza")).toBe("Maria S.");
  });
  it("nome único fica como está", () => {
    expect(nomeCurtoDoResponsavel("Rafael")).toBe("Rafael");
  });
  it("normaliza espaços e caixa da inicial", () => {
    expect(nomeCurtoDoResponsavel("  joão   alves ")).toBe("joão A.");
  });
});

describe("resolverResponsavelDaLinha", () => {
  const membros = new Map([
    ["tm-1", { id: "tm-1", name: "Ana Paula Souza" }],
    ["tm-sem-nome", { id: "tm-sem-nome", name: "  " }],
  ]);
  const ownerByLead = new Map<string, string | null>([
    ["lead-dono", "tm-1"],
    ["lead-sem-dono", null],
    ["lead-orfao", "tm-que-saiu"],
    ["lead-sem-nome", "tm-sem-nome"],
  ]);
  const base = { ownerByLead, ownerStatus: "ready" as const, membros };

  it("com dono: nome curto + completo", () => {
    expect(resolverResponsavelDaLinha({ ...base, leadId: "lead-dono" })).toEqual({
      nome: "Ana S.",
      nomeCompleto: "Ana Paula Souza",
    });
  });
  it("lead sem dono → null", () => {
    expect(resolverResponsavelDaLinha({ ...base, leadId: "lead-sem-dono" })).toBeNull();
  });
  it("membro não encontrado → null (nunca uuid)", () => {
    expect(resolverResponsavelDaLinha({ ...base, leadId: "lead-orfao" })).toBeNull();
  });
  it("membro com nome em branco → null", () => {
    expect(resolverResponsavelDaLinha({ ...base, leadId: "lead-sem-nome" })).toBeNull();
  });
  it("sem lead → undefined", () => {
    expect(resolverResponsavelDaLinha({ ...base, leadId: null })).toBeUndefined();
  });
  it("mapa pendente ou com erro → undefined (não pisca 'Sem responsável')", () => {
    expect(resolverResponsavelDaLinha({ ...base, ownerStatus: "pending", leadId: "lead-sem-dono" })).toBeUndefined();
    expect(resolverResponsavelDaLinha({ ...base, ownerStatus: "error", leadId: "lead-sem-dono" })).toBeUndefined();
  });
  it("membros ainda não carregados → undefined", () => {
    expect(resolverResponsavelDaLinha({ ...base, membros: null, leadId: "lead-dono" })).toBeUndefined();
  });
  it("lead fora do mapa (não voltou na consulta) → undefined", () => {
    expect(resolverResponsavelDaLinha({ ...base, leadId: "lead-desconhecido" })).toBeUndefined();
  });
});
