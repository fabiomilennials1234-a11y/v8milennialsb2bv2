import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatSummary,
  summaryDate,
  summaryField,
  summaryPages,
} from "./format-summary";

const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  failure: "",
  reads: [] as { table: string; filters: unknown[][] }[],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const read = { table, filters: [] as unknown[][] };
      db.reads.push(read);
      let single = false;
      let from = 0;
      let to = 499;
      const query = {
        select: () => query,
        order: () => query,
        eq: (...args: unknown[]) => {
          read.filters.push(args);
          return query;
        },
        is: (...args: unknown[]) => {
          read.filters.push(args);
          return query;
        },
        single: () => {
          single = true;
          return query;
        },
        range: (a: number, b: number) => {
          from = a;
          to = b;
          return query;
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            resolve({
              data: single
                ? (db.rows[table]?.[0] ?? null)
                : (db.rows[table] ?? []).slice(from, to + 1),
              error:
                db.failure === table ? { message: "Consulta recusada" } : null,
            }),
          ),
      };
      return query;
    },
  },
}));
vi.mock("../../../leads/LeadCard", () => ({
  ORIGIN_COLORS: { site: { label: "Site" } },
}));
import { loadLeadSummary } from "./load-summary";

beforeEach(() => {
  db.failure = "";
  db.reads = [];
  db.rows = {
    leads: [
      {
        id: "lead",
        organization_id: "org",
        name: "Ana",
        faturamento: 0,
        created_at: "2026-09-10",
        pre_sale_responsible_id: "pre",
        sale_responsible_id: "sale",
        pre_qualification_tier: "ouro",
        qualification_tier: "prata",
        origin: "site",
      },
    ],
    team_members: [
      { id: "pre", name: "Maria" },
      { id: "sale", name: "Pedro" },
    ],
    pipeline_entries: [
      { id: "entry", pipeline_id: "pipe", stage_key: "negociando" },
    ],
    pipelines: [{ id: "pipe", slug: "custom", name: "Distribuidores" }],
    pipeline_stages: [
      { pipeline_id: "pipe", stage_key: "negociando", name: "Em negociação" },
    ],
    lead_custom_field_values: [
      {
        value: "false",
        field: {
          field_name: "Contrato",
          field_type: "boolean",
          display_order: 1,
        },
      },
      {
        value: "0",
        field: {
          field_name: "Filiais",
          field_type: "number",
          display_order: 2,
        },
      },
    ],
    lead_comments: [
      {
        body: "Pedido completo\nEntregar sexta",
        author_team_member_id: "pre",
        created_at: "2026-09-10",
      },
    ],
    pipe_propostas: [
      {
        id: "proposal",
        status: "proposta_enviada",
        sale_value: 300,
        loss_reason: null,
      },
    ],
    pipe_proposta_items: [
      {
        quantity: 2,
        unit_price: 150,
        sale_value: 300,
        product: { name: "Peça" },
      },
    ],
    checklists: [{ id: "list", title: "Documentos" }],
    checklist_items: [{ title: "CNPJ", is_completed: true }],
    lead_history: [
      { action: "comment_added", description: "Duplicado" },
      {
        action: "stage_changed",
        description: "Proposta enviada",
        created_at: "2026-09-10",
        source: "manual",
      },
    ],
  };
  Object.assign(db.rows.pipeline_entries[0]!, {
    deal_id: "deal",
    metadata: {},
    created_at: "2026-09-10",
  });
  db.rows.deals = [
    {
      id: "deal",
      title: "Reposição",
      value: 300,
      currency: "BRL",
      created_at: "2026-09-10",
    },
  ];
  db.rows.deal_items = [
    {
      id: "item",
      product_name: "Peça",
      quantity: 2,
      unit_price: 150,
      discount_percent: 0,
      total: 300,
      sort_order: 0,
    },
  ];
});

describe("Resumo fiel ao card", () => {
  it("mantém responsáveis, qualificações e dados completos separados", async () => {
    const text = await loadLeadSummary("lead", "org", "entry");
    for (const expected of [
      "Pré-venda: Maria",
      "Venda: Pedro",
      "Pré-qualificação: Ouro",
      "Qualificação: Prata",
      "Distribuidores: Em negociação",
      "Contrato: Não",
      "Filiais: 0",
      "Pedido completo\nEntregar sexta",
      "Peça — 2 un.",
      "[x] CNPJ",
      "Origem: Site",
    ])
      expect(text).toContain(expected);
    expect(text).toMatch(/Faturamento: R\$\s0,00/);
    expect(text).toMatch(/Valor total: R\$\s300,00/);
    expect(text).not.toContain("Duplicado");
    expect(text).not.toContain("undefined");
  });
  it.each(["desqualificado", "bronze", "prata", "ouro", "diamante"])(
    "preserva nível %s em ambas qualificações",
    async (tier) => {
      Object.assign(db.rows.leads[0]!, {
        pre_qualification_tier: tier,
        qualification_tier: tier,
      });
      const text = await loadLeadSummary("lead", "org", "entry");
      const label = tier[0].toUpperCase() + tier.slice(1);
      expect(text).toContain(`Pré-qualificação: ${label}`);
      expect(text).toContain(`Qualificação: ${label}`);
    },
  );
  it("não inventa responsáveis ou classificações ausentes", async () => {
    Object.assign(db.rows.leads[0]!, {
      pre_sale_responsible_id: null,
      qualification_tier: null,
    });
    const text = await loadLeadSummary("lead", "org", "entry");
    expect(text).toContain("Pré-venda: Não definido");
    expect(text).toContain("Qualificação: Não definido");
  });
  it("consulta organização e lead autorizados e exclui comentários removidos", async () => {
    await loadLeadSummary("lead", "org", "entry");
    expect(db.reads.filter((r) => r.table === "leads")).toHaveLength(2);
    for (const table of [
      "leads",
      "lead_comments",
      "lead_history",
      "pipeline_entries",
      "deals",
      "checklists",
    ]) {
      expect(db.reads.find((r) => r.table === table)?.filters).toContainEqual([
        "organization_id",
        "org",
      ]);
    }
    expect(
      db.reads.find((r) => r.table === "lead_comments")?.filters,
    ).toContainEqual(["deleted_at", null]);
    expect(
      db.reads.find((r) => r.table === "deal_items")?.filters,
    ).toContainEqual(["deal_id", "deal"]);
  });
  it("interrompe antes de consultar relações quando acesso é recusado", async () => {
    db.failure = "leads";
    await expect(loadLeadSummary("lead", "other-org", "entry")).rejects.toThrow(
      "sem permissão",
    );
    expect(db.reads).toHaveLength(1);
  });
  it("não entrega resumo parcial quando uma relação falha", async () => {
    db.failure = "lead_comments";
    await expect(loadLeadSummary("lead", "org", "entry")).rejects.toThrow(
      "Consulta recusada",
    );
  });
});

describe("Formatação e paginação", () => {
  it("omite vazios, preserva zero e falso", () => {
    expect(
      formatSummary([
        { title: "VAZIO", lines: [summaryField("Email", null)] },
        {
          title: "DADOS",
          lines: [summaryField("Total", 0), summaryField("Ativo", false)],
        },
      ]),
    ).toBe("RESUMO DO NEGÓCIO\n\nDADOS\nTotal: 0\nAtivo: Não");
    expect(summaryDate("2026-09-10")).toBe("10/09/2026");
  });
  it("carrega além de 1000 registros sem truncamento", async () => {
    const records = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const fetch = vi.fn(async (from: number, to: number) => ({
      data: records.slice(from, to + 1),
      error: null,
    }));
    expect(await summaryPages(fetch)).toEqual(records);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("falha se página posterior não carregar", async () => {
    await expect(
      summaryPages(async (from) =>
        from === 0
          ? { data: Array(500).fill(0), error: null }
          : { data: null, error: { message: "Falha de rede" } },
      ),
    ).rejects.toThrow("Falha de rede");
  });
});

it("copia o negócio aberto com produtos atuais, descontos, anotação e escopo dos checklists", async () => {
  Object.assign(db.rows.pipeline_entries[0]!, {
    lead_id: "lead",
    organization_id: "org",
    deal_id: "deal",
    metadata: {},
    notes: "Entrega expressa",
    created_at: "2026-09-10",
    updated_at: "now",
  });
  db.rows.deals = [
    {
      id: "deal",
      title: "Reposição setembro",
      outcome: "won",
      value: 9999,
      currency: "BRL",
      probability: 80,
      created_at: "2026-09-10",
      updated_at: "now",
    },
  ];
  db.rows.deal_items = [
    {
      id: "item",
      product_name: "Motor",
      quantity: 2,
      unit_price: 100,
      discount_percent: 10,
      total: 180,
      sort_order: 0,
    },
  ];
  db.rows.checklists = [
    { id: "list", title: "Deste negócio", pipeline_entry_id: "entry" },
    { id: "other", title: "Não exportar", pipeline_entry_id: "other" },
  ];
  Object.assign(db.rows.lead_comments[0]!, { pipeline_entry_id: "other" });
  const text = await loadLeadSummary("lead", "org", "entry");
  for (const expected of [
    "Nome: Reposição setembro",
    "Situação: Ganho",
    "Estágio: Em negociação",
    "Anotação do negócio: Entrega expressa",
    "Motor — 2 un.",
    "Desconto: 10%",
    "Comentário de outro negócio",
    "Deste negócio",
  ])
    expect(text).toContain(expected);
  expect(text).toMatch(/Valor total: R\$\s180,00/);
  expect(text).not.toContain("Não exportar");
  expect(text).not.toContain("Peça —");
  expect(db.reads.some((r) => r.table === "pipe_propostas")).toBe(false);
  expect(
    db.reads.find((r) => r.table === "deal_items")?.filters,
  ).toContainEqual(["organization_id", "org"]);
});

it("preserva nomes históricos após transferência e renomeação", async () => {
  db.rows.pipeline_stage_events = [
    {
      id: "move",
      pipeline_id: "old-pipe",
      from_stage_key: "old",
      to_stage_key: "new",
      from_stage_name: "Proposta antiga",
      to_stage_name: "Fechamento antigo",
      from_pipeline_name: "Pré-venda",
      to_pipeline_name: "Venda",
      actor_name: "Autor histórico",
      occurred_at: "2026-09-10",
    },
  ];
  const text = await loadLeadSummary("lead", "org", "entry");
  expect(text).toContain(
    "Pré-venda → Venda: Proposta antiga → Fechamento antigo — Autor histórico",
  );
});

it("mantém faixa textual de faturamento sem converter para NaN", async () => {
  Object.assign(db.rows.leads[0]!, { faturamento: "R$ 50 mil a R$ 100 mil" });
  expect(await loadLeadSummary("lead", "org", "entry")).toContain(
    "Faturamento: R$ 50 mil a R$ 100 mil",
  );
});
