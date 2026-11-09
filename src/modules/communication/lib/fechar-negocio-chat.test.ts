import { describe, expect, it } from "vitest";
import { planoDeFechamento, sugerirEtapaDeFechamento } from "./fechar-negocio-chat";

const etapas = (...labels: string[]) => labels.map((label, i) => ({ key: `k${i}`, label }));

describe("sugerirEtapaDeFechamento", () => {
  const cafe = etapas("Novo", "Em negociação", "Vendido", "❌ Perdido");

  it("ganho sugere a etapa Vendido, perda a Perdido (nomes reais da Café Jurerê)", () => {
    expect(sugerirEtapaDeFechamento("won", cafe)).toBe("k2");
    expect(sugerirEtapaDeFechamento("lost", cafe)).toBe("k3");
  });

  it("ignora acento, caixa e emoji", () => {
    expect(sugerirEtapaDeFechamento("won", etapas("VENDIDO ✅"))).toBe("k0");
    expect(sugerirEtapaDeFechamento("won", etapas("Ganhô", "Ganho"))).toBe("k0");
    expect(sugerirEtapaDeFechamento("lost", etapas("Não prosseguiu", "PERDIDO"))).toBe("k1");
  });

  it("aceita variações de fechamento", () => {
    expect(sugerirEtapaDeFechamento("won", etapas("Pedido fechado"))).toBe("k0");
    expect(sugerirEtapaDeFechamento("won", etapas("Won"))).toBe("k0");
    expect(sugerirEtapaDeFechamento("lost", etapas("Lost"))).toBe("k0");
  });

  it("sem etapa parecida não chuta: devolve null (o padrão vira manter na etapa atual)", () => {
    expect(sugerirEtapaDeFechamento("won", etapas("Novo", "Proposta"))).toBeNull();
    expect(sugerirEtapaDeFechamento("lost", etapas("Novo", "Proposta"))).toBeNull();
    expect(sugerirEtapaDeFechamento("won", [])).toBeNull();
  });

  it("etapa de perda não é sugerida para ganho, nem o contrário", () => {
    expect(sugerirEtapaDeFechamento("won", etapas("Perdido (não vendido)"))).toBeNull();
    expect(sugerirEtapaDeFechamento("lost", etapas("Vendido"))).toBeNull();
  });

  it("com mais de uma candidata, a primeira na ordem do funil", () => {
    expect(sugerirEtapaDeFechamento("lost", etapas("Perdido - preço", "Perdido - prazo"))).toBe("k0");
  });
});

describe("planoDeFechamento", () => {
  it("destino diferente da etapa atual: move antes de dar o desfecho", () => {
    expect(planoDeFechamento({ etapaAtualKey: "a", destinoKey: "b" })).toEqual({ mover: true, destinoKey: "b" });
  });

  it("manter na etapa atual (destino nulo): só o desfecho", () => {
    expect(planoDeFechamento({ etapaAtualKey: "a", destinoKey: null })).toEqual({ mover: false, destinoKey: null });
  });

  it("destino igual à etapa atual não move (evita evento de etapa duplicado)", () => {
    expect(planoDeFechamento({ etapaAtualKey: "a", destinoKey: "a" })).toEqual({ mover: false, destinoKey: null });
  });
});
