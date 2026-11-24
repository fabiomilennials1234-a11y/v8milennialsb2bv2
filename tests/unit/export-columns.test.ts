import { describe, it, expect } from "vitest";
import {
  buildCustomFieldColumns,
  buildExportHeaders,
  buildFunnelCells,
  funnelColumnHeaders,
  isStageUuid,
  orderPipelinesForExport,
  pickLatestEntryPerFunnel,
  resolveStageName,
  type ExportPipeline,
  type ExportPipelineEntry,
  type ExportPipelineStage,
} from "@/modules/leads/lib/export-columns";

const LEAD_HEADERS = ["ID Lead", "Nome"] as const;

it("ordena campos preenchidos, diferencia nomes repetidos e preserva o valor de cada lead", () => {
  const { headers, cellsByLead } = buildCustomFieldColumns([
    { id: "f3", field_name: "Linha (2)", display_order: 3, created_at: null },
    { id: "f2", field_name: " Linha: ", display_order: 2, created_at: null },
    { id: "f4", field_name: "Vazio", display_order: 0, created_at: null },
    { id: "f1", field_name: "Linha", display_order: 1, created_at: null },
  ], [
    { field_id: "f1", lead_id: "l1", value: "Banheiro" },
    { field_id: "f2", lead_id: "l1", value: "0" },
    { field_id: "f3", lead_id: "l2", value: "Cozinha" },
    { field_id: "f4", lead_id: "l1", value: " " },
  ]);

  expect(headers).toEqual(["Campo: Linha", "Campo: Linha (2)", "Campo: Linha (2) (2)"]);
  expect(cellsByLead.get("l1")).toEqual({ "Campo: Linha": "Banheiro", "Campo: Linha (2)": "0" });
  expect(cellsByLead.get("l2")).toEqual({ "Campo: Linha (2) (2)": "Cozinha" });
});

const FUNIS: ExportPipeline[] = [
  { id: "c2", name: "Zeta Custom", slug: "zeta", type: "custom" },
  { id: "s3", name: "Orçamentos", slug: "propostas", type: "system" },
  { id: "c1", name: "Alfa Custom", slug: "alfa", type: "custom" },
  { id: "s1", name: "Oportunidades", slug: "whatsapp", type: "system" },
  { id: "s2", name: "Agendamentos", slug: "confirmacao", type: "system" },
];

describe("orderPipelinesForExport", () => {
  it("sistema primeiro na ordem canônica, custom depois por nome", () => {
    expect(orderPipelinesForExport(FUNIS).map((p) => p.id)).toEqual([
      "s1", "s2", "s3", "c1", "c2",
    ]);
  });

  it("é determinístico e não muta a entrada", () => {
    const input = [...FUNIS];
    orderPipelinesForExport(input);
    expect(input).toEqual(FUNIS);
  });
});

describe("buildExportHeaders", () => {
  it("bloco do lead + um bloco de 12 colunas POR FUNIL, batizado pelo nome do funil", () => {
    const headers = buildExportHeaders(LEAD_HEADERS, FUNIS);
    expect(headers.length).toBe(LEAD_HEADERS.length + FUNIS.length * 12);
    expect(headers).toContain("Etapa — Oportunidades");
    expect(headers).toContain("Valor venda (R$) — Orçamentos");
    expect(headers).toContain("Etapa — Alfa Custom"); // custom entra no arquivo
    // Fim dos 3 cabeçalhos fixos: nenhum rótulo hardcoded de pipe sobrevive
    expect(headers).not.toContain("Etapa Pipe Qualificação");
    expect(headers).not.toContain("Etapa Pipe Propostas");
  });
});

describe("funnelColumnHeaders", () => {
  it("todas as colunas carregam o nome do funil", () => {
    const cols = funnelColumnHeaders("Radar");
    expect(cols).toHaveLength(12);
    for (const c of cols) expect(c.endsWith("— Radar")).toBe(true);
  });
});

describe("resolveStageName", () => {
  const stages: ExportPipelineStage[] = [
    { id: "st-1", pipeline_id: "p1", stage_key: "novo", name: "Novo Lead" },
  ];
  const byId = new Map(stages.map((s) => [s.id, s]));
  const byKey = new Map(stages.map((s) => [`${s.pipeline_id}:${s.stage_key}`, s]));

  it("stage_id (uuid canônico) vence", () => {
    const entry: ExportPipelineEntry = { pipeline_id: "p1", lead_id: "l", stage_id: "st-1", stage_key: "outro" };
    expect(resolveStageName(entry, byId, byKey)).toBe("Novo Lead");
  });

  it("entry legada resolve por (pipeline_id, stage_key)", () => {
    const entry: ExportPipelineEntry = { pipeline_id: "p1", lead_id: "l", stage_key: "novo" };
    expect(resolveStageName(entry, byId, byKey)).toBe("Novo Lead");
  });

  it("stage_key sem etapa correspondente sai cru — nunca célula vazia com entry presente", () => {
    const entry: ExportPipelineEntry = { pipeline_id: "p1", lead_id: "l", stage_key: "orfao" };
    expect(resolveStageName(entry, byId, byKey)).toBe("orfao");
  });
});

describe("buildFunnelCells", () => {
  const ctx = {
    stagesById: new Map<string, ExportPipelineStage>(),
    stagesByPipelineAndKey: new Map<string, ExportPipelineStage>([
      ["p1:vendido", { id: "st-9", pipeline_id: "p1", stage_key: "vendido", name: "Vendido ✓" }],
    ]),
    memberName: (id: string | null | undefined) => (id === "tm-1" ? "Ana" : ""),
    fmtDate: (v: string | null | undefined) => (v ? `d(${v})` : ""),
  };

  it("sem entry: todas as células do bloco saem vazias", () => {
    const cells = buildFunnelCells("Radar", undefined, ctx);
    expect(Object.keys(cells)).toHaveLength(12);
    expect(Object.values(cells).every((v) => v === "")).toBe(true);
  });

  it("com entry: etapa por nome real, responsável por precedência de metadata e valores do metadata", () => {
    const entry: ExportPipelineEntry = {
      pipeline_id: "p1",
      lead_id: "l1",
      stage_key: "vendido",
      notes: "obs",
      closed_at: "2026-01-02",
      created_at: "2026-01-01",
      updated_at: "2026-01-03",
      assigned_to: "tm-x",
      metadata: {
        responsible_id: "tm-1",
        sale_value: "1500.5",
        meeting_date: "2026-02-01",
        is_confirmed: true,
        product_type: "recorrente",
        contract_duration: 12,
        metrics_period_at: "2026-03-01",
      },
    };
    const cells = buildFunnelCells("Radar", entry, ctx);
    expect(cells["Etapa — Radar"]).toBe("Vendido ✓");
    expect(cells["Responsável — Radar"]).toBe("Ana"); // metadata vence assigned_to
    expect(cells["Valor venda (R$) — Radar"]).toBe(1500.5);
    expect(cells["Data reunião — Radar"]).toBe("d(2026-02-01)");
    expect(cells["Reunião confirmada (sim/não) — Radar"]).toBe("sim");
    expect(cells["Tipo produto — Radar"]).toBe("recorrente");
    expect(cells["Duração contrato (meses) — Radar"]).toBe(12);
    expect(cells["Data fechamento — Radar"]).toBe("d(2026-01-02)");
    expect(cells["Notas — Radar"]).toBe("obs");
  });

  it("scheduled_date (Qualificação legada) cobre Data reunião quando meeting_date falta", () => {
    const entry: ExportPipelineEntry = {
      pipeline_id: "p1",
      lead_id: "l1",
      metadata: { scheduled_date: "2026-04-01" },
    };
    const cells = buildFunnelCells("Radar", entry, ctx);
    expect(cells["Data reunião — Radar"]).toBe("d(2026-04-01)");
    // is_confirmed ausente → célula vazia (não "não")
    expect(cells["Reunião confirmada (sim/não) — Radar"]).toBe("");
  });
});

describe("pickLatestEntryPerFunnel", () => {
  it("uma entry por (funil, lead) — updated_at mais recente vence (desempate legado)", () => {
    const entries: ExportPipelineEntry[] = [
      { pipeline_id: "p1", lead_id: "l1", stage_key: "a", updated_at: "2026-01-01" },
      { pipeline_id: "p1", lead_id: "l1", stage_key: "b", updated_at: "2026-02-01" },
      { pipeline_id: "p2", lead_id: "l1", stage_key: "c", updated_at: "2026-01-15" },
      { pipeline_id: "p1", lead_id: null, stage_key: "x" }, // lead nulo descartado
    ];
    const picked = pickLatestEntryPerFunnel(entries);
    expect(picked.size).toBe(2);
    expect(picked.get("p1:l1")?.stage_key).toBe("b");
    expect(picked.get("p2:l1")?.stage_key).toBe("c");
  });
});

describe("isStageUuid", () => {
  it("uuid → stage_id; stage_key legado → false", () => {
    expect(isStageUuid("11111111-2222-4333-8444-555555555555")).toBe(true);
    expect(isStageUuid("novo")).toBe(false);
    expect(isStageUuid("reuniao_marcada")).toBe(false);
  });
});
