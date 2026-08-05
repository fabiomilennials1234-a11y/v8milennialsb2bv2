import { describe, expect, it } from "vitest";

import { deriveLeadStanding, deriveLeadStandings } from "./lead-relacao-situacao";
import type { LeadDeal } from "../hooks/useLeadsDeals";
import type { LeadCarteiraMetrics } from "../hooks/useLeadsCarteiraMetrics";
import type { LeadSalesMetrics } from "../hooks/useLeadsSalesMetrics";

function negocio(over: Partial<LeadDeal> = {}): LeadDeal {
  return {
    id: over.id ?? "entry-1",
    leadId: "lead-1",
    title: "Negócio de ago/2026",
    funnelName: "Qualificação",
    funnelColor: "#22c55e",
    pipelineId: "pipe-1",
    pipelineSlug: "whatsapp",
    isSystem: true,
    stageKey: "abordado",
    stageName: "Abordado",
    stagePosition: 1,
    stageIndex: 1,
    stageCount: 5,
    outcome: "open",
    won: false,
    value: 0,
    meetingDate: null,
    enteredAt: null,
    stageChangedAt: null,
    daysInStage: null,
    ...over,
  };
}

function vendas(over: Partial<LeadSalesMetrics> = {}): LeadSalesMetrics {
  return {
    leadId: "lead-1",
    saleCount: 1,
    totalValue: 1000,
    avgTicket: 1000,
    lastSaleAt: "2026-07-01T12:00:00.000Z",
    daysSinceLastSale: 34,
    cycleDays: null,
    ...over,
  };
}

function carteira(over: Partial<LeadCarteiraMetrics> = {}): LeadCarteiraMetrics {
  return {
    leadId: "lead-1",
    lifetimeValue: 5000,
    avgTicket: 1250,
    orderCount: 4,
    reorderCycleDays: 60,
    daysSinceLastOrder: 12,
    segment: "ouro",
    ...over,
  };
}

describe("Relação", () => {
  it("sem prova nenhuma é Lead", () => {
    const s = deriveLeadStanding({});
    expect(s.relacao).toBe("lead");
    expect(s.prova).toBeNull();
  });

  it("venda líquida no funil torna Cliente", () => {
    const s = deriveLeadStanding({ vendas: vendas() });
    expect(s.relacao).toBe("cliente");
    expect(s.prova).toBe("funil");
  });

  it("pedido de ERP torna Cliente", () => {
    const s = deriveLeadStanding({ carteira: carteira() });
    expect(s.relacao).toBe("cliente");
    expect(s.prova).toBe("erp");
  });

  it("as duas provas juntas", () => {
    const s = deriveLeadStanding({ vendas: vendas(), carteira: carteira() });
    expect(s.prova).toBe("ambas");
  });

  it("linha de carteira SEM pedido não torna Cliente", () => {
    // 554 das 735 linhas de `upsell_clients` em prod são assim: cliente
    // cadastrado pela integração que nunca comprou. A prova da ADR-0023 §7 é
    // "an ERP order", não a existência da linha.
    const s = deriveLeadStanding({
      carteira: carteira({ orderCount: 0, lifetimeValue: 0, avgTicket: 0 }),
    });
    expect(s.relacao).toBe("lead");
    expect(s.prova).toBeNull();
  });

  it("venda estornada não torna Cliente", () => {
    // `computeSalesMetrics` já desconta o estorno; aqui garante que saleCount 0
    // não vaza para Cliente por presença do objeto.
    const s = deriveLeadStanding({ vendas: vendas({ saleCount: 0, totalValue: 0 }) });
    expect(s.relacao).toBe("lead");
  });

  it("card numa etapa ganha NÃO decide sozinho a Relação", () => {
    // A fonte é o ledger, não a posição — decisão 4 fez o card sair da etapa
    // onde ganhou. Em prod, cards em etapa ganha sem evento são 0, então esta
    // combinação não existe na base; o teste fixa a regra, não o dado.
    const s = deriveLeadStanding({ deals: [negocio({ outcome: "won", won: true })] });
    expect(s.relacao).toBe("lead");
  });
});

describe("Situação", () => {
  it("sem negócio nenhum", () => {
    const s = deriveLeadStanding({});
    expect(s.emNegociacao).toBe(false);
    expect(s.maisAvancado).toBeNull();
  });

  it("só negócio fechado não é negociação aberta", () => {
    const s = deriveLeadStanding({
      deals: [negocio({ outcome: "won", won: true }), negocio({ id: "e2", outcome: "lost" })],
    });
    expect(s.emNegociacao).toBe(false);
    expect(s.maisAvancado).toBeNull();
  });

  it("negócio aberto abre a negociação", () => {
    const s = deriveLeadStanding({ deals: [negocio()] });
    expect(s.emNegociacao).toBe(true);
    expect(s.maisAvancado?.funnelName).toBe("Qualificação");
  });

  it("Cliente e Em negociação ao mesmo tempo — o cliente que voltou", () => {
    // 180 leads em prod. É o caso que proíbe colapsar os dois num status só.
    const s = deriveLeadStanding({
      vendas: vendas(),
      deals: [negocio({ outcome: "won", won: true }), negocio({ id: "e2", outcome: "open" })],
    });
    expect(s.relacao).toBe("cliente");
    expect(s.emNegociacao).toBe(true);
  });
});

describe("qual negócio aberto está mais avançado", () => {
  const whats = negocio({ id: "w", pipelineSlug: "whatsapp", funnelName: "Qualificação", stagePosition: 3 });
  const confirm = negocio({ id: "c", pipelineSlug: "confirmacao", funnelName: "Confirmação", stagePosition: 1 });
  const props = negocio({ id: "p", pipelineSlug: "propostas", funnelName: "Orçamentos", stagePosition: 0 });
  const custom = negocio({
    id: "x", isSystem: false, pipelineSlug: "reativacao",
    funnelName: "Reativação", stagePosition: 9,
  });

  it("propostas ganha de confirmação, que ganha de qualificação", () => {
    expect(deriveLeadStanding({ deals: [whats, confirm] }).maisAvancado?.id).toBe("c");
    expect(deriveLeadStanding({ deals: [confirm, props] }).maisAvancado?.id).toBe("p");
    expect(deriveLeadStanding({ deals: [whats, confirm, props] }).maisAvancado?.id).toBe("p");
  });

  it("funil system ganha de custom mesmo com etapa mais alta no custom", () => {
    // 3.959 leads (88% dos que têm vários abertos) misturam system e custom.
    // A cadeia system é o caminho até o dinheiro; custom é cadeia paralela.
    expect(deriveLeadStanding({ deals: [custom, whats] }).maisAvancado?.id).toBe("w");
  });

  it("sem nenhum system aberto, o custom responde", () => {
    const outro = negocio({ id: "x2", isSystem: false, pipelineSlug: "pos-venda", funnelName: "Pós-venda", stagePosition: 2 });
    expect(deriveLeadStanding({ deals: [outro, custom] }).maisAvancado?.id).toBe("x");
  });

  it("dois abertos no MESMO funil desempatam pela etapa", () => {
    // Hoje 0 casos em prod — só porque as três travas de unicidade caíram na
    // migration 20270730000050. É exatamente a compra repetida que a fatia 2
    // veio permitir, então a regra já nasce precisando disto.
    const cedo = negocio({ id: "a", stagePosition: 1 });
    const tarde = negocio({ id: "b", stagePosition: 4 });
    expect(deriveLeadStanding({ deals: [cedo, tarde] }).maisAvancado?.id).toBe("b");
    expect(deriveLeadStanding({ deals: [tarde, cedo] }).maisAvancado?.id).toBe("b");
  });

  it("negócio fechado nunca é o mais avançado", () => {
    const ganho = negocio({ id: "g", pipelineSlug: "propostas", outcome: "won", won: true, stagePosition: 9 });
    expect(deriveLeadStanding({ deals: [ganho, whats] }).maisAvancado?.id).toBe("w");
  });

  it("a resposta não depende da ordem de entrada", () => {
    const alvo = deriveLeadStanding({ deals: [whats, confirm, props, custom] }).maisAvancado?.id;
    expect(deriveLeadStanding({ deals: [custom, props, confirm, whats] }).maisAvancado?.id).toBe(alvo);
    expect(deriveLeadStanding({ deals: [props, custom, whats, confirm] }).maisAvancado?.id).toBe(alvo);
  });

  it("etapa sem position não derruba a escolha", () => {
    const semPos = negocio({ id: "s", stagePosition: null });
    const comPos = negocio({ id: "cp", stagePosition: 0 });
    expect(deriveLeadStanding({ deals: [semPos, comPos] }).maisAvancado?.id).toBe("cp");
  });
});

describe("derivação da página inteira", () => {
  it("lead ausente dos três mapas cai no estado padrão", () => {
    const out = deriveLeadStandings(["a", "b"], {
      deals: { a: [negocio()] },
      vendas: { a: vendas() },
      carteira: {},
    });

    expect(out.a).toMatchObject({ relacao: "cliente", emNegociacao: true });
    expect(out.b).toMatchObject({ relacao: "lead", emNegociacao: false, maisAvancado: null });
  });

  it("devolve uma entrada por lead pedido, nem mais nem menos", () => {
    const out = deriveLeadStandings(["a", "b", "c"], { deals: { z: [negocio()] } });
    expect(Object.keys(out).sort()).toEqual(["a", "b", "c"]);
  });
});
