/**
 * `useLeadsDeals` — a etapa do negócio: posição, índice e total.
 *
 * Três campos, dois consumidores, e a diferença entre eles é o que este
 * arquivo existe para travar.
 *
 * ── `stagePosition` — o desempate da Situação (ADR-0023 §6) ───────────────
 * A coluna "Situação" mostra o Negócio ABERTO mais avançado. Quando dois
 * negócios estão no MESMO funil, o único critério que resta é a etapa: sem
 * `stagePosition` o desempate cai no nome do funil e a linha passa a oscilar
 * entre dois negócios a cada render. Dois abertos no mesmo funil hoje são 0
 * casos em prod — e só porque as três travas de unicidade caíram na migration
 * `20270730000050`. É exatamente a compra repetida que a fatia 2 veio permitir,
 * então a regra nasce precisando disto.
 *
 * ── `stageIndex` + `stageCount` — a barra de progresso ────────────────────
 * `stagePosition` sozinho **não serve de denominador**. `position` é o número
 * que a org escolheu, não um ordinal: as etapas vêm numeradas 0/10/20/30 em
 * umas orgs, e com buracos onde alguém apagou etapa no meio noutras. Uma barra
 * desenhada com `stagePosition / stageCount` daria 20/4 — 500% de progresso.
 * `stageIndex` é a posição ORDINAL entre as etapas ativas do próprio funil, e
 * `stageCount` é quantas existem lá. Os dois andam juntos ou não valem nada.
 *
 * As asserções abaixo cobrem os três casos que quebram na vida real: numeração
 * esparsa, etapa apagada no meio, e funil custom — onde a entry guarda ora o
 * uuid da etapa, ora o `stage_key` (a mesma dualidade que `useLeadAllPipelines`
 * já tolera em `stages.find(s => s.stage_key === … || s.id === …)`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const ORG = "org-1";

/** Linhas servidas por tabela; cada teste monta o cenário que precisa. */
const rows = vi.hoisted(() => ({}) as Record<string, unknown[]>);

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: ORG, isReady: true }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    for (const m of ["select", "eq", "in", "order", "limit", "is", "not"]) builder[m] = self;
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
    return builder;
  };
  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import { useLeadsDeals, type LeadDeal } from "@/modules/leads/hooks/useLeadsDeals";
import { deriveLeadStanding } from "@/modules/leads/lib/lead-relacao-situacao";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

/** Uma entry (= um card = a POSIÇÃO do negócio) em `pipeline_entries`. */
function entry(over: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    lead_id: "lead-1",
    pipeline_id: "pipe-1",
    stage_key: "novo",
    entered_at: "2026-08-01T00:00:00Z",
    stage_changed_at: "2026-08-01T00:00:00Z",
    metadata: {},
    deal_id: null,
    ...over,
  };
}

async function negocios(): Promise<LeadDeal[]> {
  const { result } = renderHook(() => useLeadsDeals(["lead-1"]), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data?.["lead-1"]).toBeTruthy());
  return result.current.data!["lead-1"];
}

/** Acha o negócio pelo id da entry — a ordem de saída é a do hook, não a minha. */
const porId = (lista: LeadDeal[], id: string) => lista.find((d) => d.id === id)!;

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  rows.pipelines = [];
  rows.pipeline_stages = [];
  rows.pipeline_stages = [];
  rows.pipeline_entries = [];
  rows.deals = [];
});

describe("posição da etapa — o desempate da Situação", () => {
  it("a posição vem de `pipeline_stages`, não do card", () => {
    // O card guarda só a chave da etapa. Quem sabe onde essa etapa fica na
    // ordem do funil é a tabela de etapas — inclusive depois de a org
    // reordenar o funil, o que muda a posição sem tocar em nenhum card.
    rows.pipelines = [
      { id: "pipe-1", slug: "whatsapp", name: "Qualificação", color: "#0f0", type: "system" },
    ];
    rows.pipeline_stages = [
      { id: "pipe-1-novo", pipeline_id: "pipe-1", stage_key: "novo", name: "Novo", stage_role: null, position: 0 },
      { id: "pipe-1-abordado", pipeline_id: "pipe-1", stage_key: "abordado", name: "Abordado", stage_role: null, position: 1 },
      { id: "pipe-1-respondeu", pipeline_id: "pipe-1", stage_key: "respondeu", name: "Respondeu", stage_role: null, position: 2 },
    ];
    rows.pipeline_entries = [entry({ stage_key: "respondeu" })];

    return negocios().then((lista) => {
      expect(lista[0].stagePosition).toBe(2);
      expect(lista[0].stageName).toBe("Respondeu");
    });
  });

  it("cada funil tem a sua numeração — a posição não vaza entre funis", async () => {
    // `whatsapp` e `propostas` têm ambos uma etapa `novo`, em posições
    // diferentes. Indexar as etapas só por `stage_key` misturaria as duas e o
    // desempate passaria a comparar números de funis diferentes.
    rows.pipelines = [
      { id: "pipe-1", slug: "whatsapp", name: "Qualificação", color: "#0f0", type: "system" },
      { id: "pipe-2", slug: "propostas", name: "Orçamentos", color: "#00f", type: "system" },
    ];
    rows.pipeline_stages = [
      { id: "pipe-1-novo", pipeline_id: "pipe-1", stage_key: "novo", name: "Novo lead", stage_role: null, position: 0 },
      { id: "pipe-2-novo", pipeline_id: "pipe-2", stage_key: "novo", name: "Nova proposta", stage_role: null, position: 3 },
    ];
    rows.pipeline_entries = [
      entry({ id: "e-whats", pipeline_id: "pipe-1", stage_key: "novo" }),
      entry({ id: "e-prop", pipeline_id: "pipe-2", stage_key: "novo" }),
    ];

    const lista = await negocios();
    expect(porId(lista, "e-whats").stagePosition).toBe(0);
    expect(porId(lista, "e-whats").stageName).toBe("Novo lead");
    expect(porId(lista, "e-prop").stagePosition).toBe(3);
    expect(porId(lista, "e-prop").stageName).toBe("Nova proposta");
  });

  it("etapa apagada não vira card fantasma — some a posição, não o negócio", async () => {
    // Mesma classe do incidente ghost-stage do `lead-webhook`: o card tem que
    // continuar aparecendo com a chave crua. Sumir é como o lead "desaparece".
    rows.pipelines = [
      { id: "pipe-1", slug: "whatsapp", name: "Qualificação", color: "#0f0", type: "system" },
    ];
    rows.pipeline_stages = [
      { id: "pipe-1-novo", pipeline_id: "pipe-1", stage_key: "novo", name: "Novo", stage_role: null, position: 0 },
    ];
    rows.pipeline_entries = [entry({ stage_key: "etapa_que_sumiu" })];

    const lista = await negocios();
    expect(lista).toHaveLength(1);
    expect(lista[0].stagePosition).toBeNull();
    expect(lista[0].stageName).toBe("etapa_que_sumiu");
  });

  it("a posição que o hook carrega é a que decide a Situação", async () => {
    // Fecha o circuito com `deriveLeadStanding`: dois negócios abertos no MESMO
    // funil, e quem responde "Em negociação · …" é o que está mais à frente.
    // Sem `stagePosition` os dois empatam e a escolha vira sorteio por render.
    rows.pipelines = [
      { id: "pipe-1", slug: "whatsapp", name: "Qualificação", color: "#0f0", type: "system" },
    ];
    rows.pipeline_stages = [
      { id: "pipe-1-novo", pipeline_id: "pipe-1", stage_key: "novo", name: "Novo", stage_role: null, position: 0 },
      { id: "pipe-1-agendado", pipeline_id: "pipe-1", stage_key: "agendado", name: "Agendado", stage_role: null, position: 4 },
    ];
    rows.pipeline_entries = [
      entry({ id: "atras", stage_key: "novo" }),
      entry({ id: "frente", stage_key: "agendado" }),
    ];

    const lista = await negocios();
    const standing = deriveLeadStanding({ deals: lista });

    expect(standing.emNegociacao).toBe(true);
    expect(standing.maisAvancado?.id).toBe("frente");
    expect(standing.maisAvancado?.stageName).toBe("Agendado");
  });
});

describe("índice e total da etapa — o denominador da barra de progresso", () => {
  /** Funil system com numeração esparsa: 0, 10, 20, 30 — quatro etapas. */
  function funilEsparso() {
    rows.pipelines = [
      { id: "pipe-1", slug: "whatsapp", name: "Qualificação", color: "#0f0", type: "system" },
    ];
    rows.pipeline_stages = [
      { id: "pipe-1-a", pipeline_id: "pipe-1", stage_key: "a", name: "A", stage_role: null, position: 0 },
      { id: "pipe-1-b", pipeline_id: "pipe-1", stage_key: "b", name: "B", stage_role: null, position: 10 },
      { id: "pipe-1-c", pipeline_id: "pipe-1", stage_key: "c", name: "C", stage_role: null, position: 20 },
      { id: "pipe-1-d", pipeline_id: "pipe-1", stage_key: "d", name: "D", stage_role: null, position: 30 },
    ];
  }

  it("numeração esparsa: o índice é ordinal, o `position` cru não é", async () => {
    // Com `position` 20 numa lista de 4 etapas, uma barra `20/4` marcaria 500%.
    // É por isto que `stagePosition` não pode ser o numerador.
    funilEsparso();
    rows.pipeline_entries = [entry({ stage_key: "c" })];

    const lista = await negocios();
    expect(lista[0].stagePosition).toBe(20);
    expect(lista[0].stageIndex).toBe(2);
    expect(lista[0].stageCount).toBe(4);
  });

  it("a última etapa fecha a barra: índice + 1 === total", async () => {
    funilEsparso();
    rows.pipeline_entries = [entry({ stage_key: "d" })];

    const lista = await negocios();
    expect(lista[0].stageIndex! + 1).toBe(lista[0].stageCount);
  });

  it("a trilha é montada por `position`, não pela ordem em que o banco devolveu", async () => {
    // PostgREST não garante ordem sem `order()`, e a consulta não pede nenhuma.
    // Confiar na ordem de chegada faria a barra andar para trás sem motivo.
    rows.pipelines = [
      { id: "pipe-1", slug: "whatsapp", name: "Qualificação", color: "#0f0", type: "system" },
    ];
    rows.pipeline_stages = [
      { id: "pipe-1-c", pipeline_id: "pipe-1", stage_key: "c", name: "C", stage_role: null, position: 2 },
      { id: "pipe-1-a", pipeline_id: "pipe-1", stage_key: "a", name: "A", stage_role: null, position: 0 },
      { id: "pipe-1-d", pipeline_id: "pipe-1", stage_key: "d", name: "D", stage_role: null, position: 3 },
      { id: "pipe-1-b", pipeline_id: "pipe-1", stage_key: "b", name: "B", stage_role: null, position: 1 },
    ];
    rows.pipeline_entries = [entry({ stage_key: "c" })];

    const lista = await negocios();
    expect(lista[0].stageIndex).toBe(2);
    expect(lista[0].stageCount).toBe(4);
  });

  it("etapa desativada no meio encolhe o total, e a barra continua fechando", async () => {
    // A consulta filtra `is_active = true`, então a etapa desligada nem chega
    // aqui — ela só deixa um buraco na numeração. O total tem que ser o das
    // etapas VIVAS: 4, não 5. Contar as posições daria 5 e a barra nunca
    // chegaria ao fim.
    rows.pipelines = [
      { id: "pipe-1", slug: "whatsapp", name: "Qualificação", color: "#0f0", type: "system" },
    ];
    rows.pipeline_stages = [
      { id: "pipe-1-a", pipeline_id: "pipe-1", stage_key: "a", name: "A", stage_role: null, position: 0 },
      { id: "pipe-1-b", pipeline_id: "pipe-1", stage_key: "b", name: "B", stage_role: null, position: 1 },
      // position 2 desativada — não vem na consulta
      { id: "pipe-1-d", pipeline_id: "pipe-1", stage_key: "d", name: "D", stage_role: null, position: 3 },
      { id: "pipe-1-e", pipeline_id: "pipe-1", stage_key: "e", name: "E", stage_role: null, position: 4 },
    ];
    rows.pipeline_entries = [entry({ stage_key: "e" })];

    const lista = await negocios();
    expect(lista[0].stagePosition).toBe(4);
    expect(lista[0].stageCount).toBe(4);
    expect(lista[0].stageIndex).toBe(3);
  });

  it("o total é o do PRÓPRIO funil do negócio, nunca o do funil vizinho", async () => {
    // Um lead com card em dois funis de tamanhos diferentes. Um denominador
    // global faria a barra do funil curto passar do fim.
    rows.pipelines = [
      { id: "pipe-1", slug: "whatsapp", name: "Qualificação", color: "#0f0", type: "system" },
      { id: "pipe-2", slug: "propostas", name: "Orçamentos", color: "#00f", type: "system" },
    ];
    rows.pipeline_stages = [
      { id: "pipe-1-w1", pipeline_id: "pipe-1", stage_key: "w1", name: "W1", stage_role: null, position: 0 },
      { id: "pipe-1-w2", pipeline_id: "pipe-1", stage_key: "w2", name: "W2", stage_role: null, position: 1 },
      { id: "pipe-1-w3", pipeline_id: "pipe-1", stage_key: "w3", name: "W3", stage_role: null, position: 2 },
      { id: "pipe-2-p1", pipeline_id: "pipe-2", stage_key: "p1", name: "P1", stage_role: null, position: 0 },
      { id: "pipe-2-p2", pipeline_id: "pipe-2", stage_key: "p2", name: "P2", stage_role: null, position: 1 },
    ];
    rows.pipeline_entries = [
      entry({ id: "e-whats", pipeline_id: "pipe-1", stage_key: "w3" }),
      entry({ id: "e-prop", pipeline_id: "pipe-2", stage_key: "p1" }),
    ];

    const lista = await negocios();
    expect(porId(lista, "e-whats").stageCount).toBe(3);
    expect(porId(lista, "e-whats").stageIndex).toBe(2);
    expect(porId(lista, "e-prop").stageCount).toBe(2);
    expect(porId(lista, "e-prop").stageIndex).toBe(0);
  });

  it("etapa desconhecida zera o índice para NULO, não para zero", async () => {
    // Zero é uma posição legítima (a primeira etapa). Devolver 0 aqui pintaria
    // uma barra "no começo" para um card cuja etapa ninguém sabe onde fica.
    // Nulo é o que permite à UI não desenhar barra nenhuma.
    funilEsparso();
    rows.pipeline_entries = [entry({ stage_key: "etapa_que_sumiu" })];

    const lista = await negocios();
    expect(lista[0].stageIndex).toBeNull();
    expect(lista[0].stageCount).toBe(4);
  });

  it("funil sem etapa ativa nenhuma devolve total zero, e índice nulo junto", async () => {
    // Denominador 0 com numerador definido é divisão por zero na tela. Os dois
    // saem juntos: sem trilha não há índice.
    rows.pipelines = [
      { id: "pipe-1", slug: "whatsapp", name: "Qualificação", color: "#0f0", type: "system" },
    ];
    rows.pipeline_stages = [];
    rows.pipeline_entries = [entry({ stage_key: "novo" })];

    const lista = await negocios();
    expect(lista[0].stageCount).toBe(0);
    expect(lista[0].stageIndex).toBeNull();
  });

  it("card sem etapa nenhuma não inventa progresso", async () => {
    funilEsparso();
    rows.pipeline_entries = [entry({ stage_key: null })];

    const lista = await negocios();
    expect(lista[0].stageIndex).toBeNull();
    expect(lista[0].stageName).toBe("sem etapa");
  });
});

describe("funil custom — a entry guarda ora o uuid da etapa, ora o `stage_key`", () => {
  function funilCustom() {
    rows.pipelines = [
      { id: "pipe-x", slug: "reativacao", name: "Reativação", color: "#f0f", type: "custom" },
    ];
    rows.pipeline_stages = [
      { id: "uuid-1", pipeline_id: "pipe-x", stage_key: "contato", name: "Contato", stage_role: null, position: 0 },
      { id: "uuid-2", pipeline_id: "pipe-x", stage_key: "proposta", name: "Proposta", stage_role: null, position: 1 },
      { id: "uuid-3", pipeline_id: "pipe-x", stage_key: "fechado", name: "Fechado", stage_role: "won", position: 2 },
    ];
  }

  it("entry que guardou o uuid da etapa tem posição, índice e total", async () => {
    funilCustom();
    rows.pipeline_entries = [entry({ pipeline_id: "pipe-x", stage_key: "uuid-2" })];

    const lista = await negocios();
    expect(lista[0].stageName).toBe("Proposta");
    expect(lista[0].stagePosition).toBe(1);
    expect(lista[0].stageIndex).toBe(1);
    expect(lista[0].stageCount).toBe(3);
  });

  it("entry que guardou o `stage_key` também — o nome e a barra vêm juntos", async () => {
    // As duas formas existem na base (é por isto que `useLeadAllPipelines`
    // testa `s.stage_key === entry.stage_key || s.id === entry.stage_key`).
    // Resolver o NOME por um caminho e o ÍNDICE por outro produz o pior
    // sintoma possível: o card mostra "Proposta" e a barra some — parece bug
    // de CSS, e ninguém procura no hook.
    funilCustom();
    rows.pipeline_entries = [entry({ pipeline_id: "pipe-x", stage_key: "proposta" })];

    const lista = await negocios();
    expect(lista[0].stageName).toBe("Proposta");
    expect(lista[0].stagePosition).toBe(1);
    expect(lista[0].stageIndex).toBe(1);
    expect(lista[0].stageCount).toBe(3);
  });

  it("o total do custom não conta as etapas dos outros funis custom da org", async () => {
    funilCustom();
    rows.pipelines = [
      ...(rows.pipelines as unknown[]),
      { id: "pipe-y", slug: "pos-venda", name: "Pós-venda", color: "#ff0", type: "custom" },
    ];
    rows.pipeline_stages = [
      ...(rows.pipeline_stages as unknown[]),
      { id: "uuid-9", pipeline_id: "pipe-y", stage_key: "ativo", name: "Ativo", stage_role: null, position: 0 },
      { id: "uuid-10", pipeline_id: "pipe-y", stage_key: "churn", name: "Churn", stage_role: null, position: 1 },
    ];
    rows.pipeline_entries = [
      entry({ id: "e-x", pipeline_id: "pipe-x", stage_key: "uuid-3" }),
      entry({ id: "e-y", pipeline_id: "pipe-y", stage_key: "uuid-10" }),
    ];

    const lista = await negocios();
    expect(porId(lista, "e-x").stageCount).toBe(3);
    expect(porId(lista, "e-y").stageCount).toBe(2);
    expect(porId(lista, "e-y").stageIndex).toBe(1);
  });

  it("etapa terminal do custom continua marcando o negócio como ganho", async () => {
    // A trilha não pode atropelar o `stage_role`: a Relação lê o ledger, mas a
    // Situação usa `outcome` para não chamar de "em negociação" um negócio já
    // fechado.
    funilCustom();
    rows.pipeline_entries = [entry({ pipeline_id: "pipe-x", stage_key: "fechado" })];

    const lista = await negocios();
    expect(lista[0].outcome).toBe("won");
    expect(deriveLeadStanding({ deals: lista }).emNegociacao).toBe(false);
  });
});
