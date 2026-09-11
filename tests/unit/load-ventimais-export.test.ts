import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadVentimaisExport, readExportPages } from "@/modules/leads/lib/load-ventimais-export";
import { VENTIMAIS_ORGANIZATION_ID as ORG } from "@/modules/leads/lib/ventimais-export";

type Row = Record<string, unknown>;
const { tables, calls, failures } = vi.hoisted(() => ({ tables: new Map<string, Row[]>(), calls: [] as { table: string; filters: [string, unknown][] }[], failures: new Set<string>() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from(table: string) {
  const call = { table, filters: [] as [string, unknown][] };
  calls.push(call);
  let rows = [...(tables.get(table) ?? [])];
  const result = () => ({ data: rows, error: failures.has(table) ? { message: "falhou" } : null });
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { call.filters.push([key, value]); rows = rows.filter(r => r[key] === value); return query; },
    is: (key: string, value: unknown) => { call.filters.push([key, value]); rows = rows.filter(r => (r[key] ?? null) === value); return query; },
    in: (key: string, values: unknown[]) => { call.filters.push([key, values]); rows = rows.filter(r => values.includes(r[key])); return query; },
    order: () => query,
    // Simula um teto de servidor menor que a página solicitada.
    range: (from: number, to: number) => { rows = rows.slice(from, Math.min(to + 1, from + 2)); return Promise.resolve(result()); },
    single: () => Promise.resolve({ data: rows[0] ?? null, error: failures.has(table) ? { message: "falhou" } : null }),
  };
  return query;
} } }));

beforeEach(() => {
  tables.clear(); calls.length = 0; failures.clear();
  tables.set("organizations", [{ id: ORG, feature_flags: { kanban_export_details: true } }]);
  tables.set("pipelines", [{ id: "pipeline-1", organization_id: ORG, name: "Funil", is_active: true }]);
  tables.set("pipeline_entries", [1, 2, 3, 4, 5].map(i => ({ id: `e${i}`, lead_id: "lead-1", organization_id: ORG, pipeline_id: "pipeline-1", stage_key: i === 5 ? "outro" : "novo" })));
  tables.set("leads", [{ id: "lead-1", organization_id: ORG }]);
  tables.set("lead_comments", [1, 2, 3, 4, 5].map(i => ({ id: `c${i}`, lead_id: "lead-1", organization_id: ORG, pipeline_entry_id: "e1" })));
});

describe("consulta do Excel Ventimais", () => {
  it("não consulta nada para outra org, CSV ou exportação global", async () => {
    expect(await loadVentimaisExport("outra", { format: "xlsx", pipelineId: "pipeline-1" })).toBeNull();
    expect(await loadVentimaisExport(ORG, { format: "csv", pipelineId: "pipeline-1" })).toBeNull();
    expect(await loadVentimaisExport(ORG, { format: "xlsx" })).toBeNull();
    expect(calls).toEqual([]);
  });
  it("flag desabilitada mantém o caminho antigo sem ler comentários", async () => {
    tables.set("organizations", [{ id: ORG, feature_flags: { kanban_export_details: false } }]);
    expect(await loadVentimaisExport(ORG, { format: "xlsx", pipelineId: "pipeline-1" })).toBeNull();
    expect(calls.map(c => c.table)).toEqual(["organizations"]);
  });
  it("rejeita kanban de outra org antes de buscar negócios", async () => {
    tables.set("pipelines", [{ id: "pipeline-1", organization_id: "outra", is_active: true }]);
    await expect(loadVentimaisExport(ORG, { format: "xlsx", pipelineId: "pipeline-1" })).rejects.toThrow("Kanban não encontrado");
    expect(calls.some(c => c.table === "pipeline_entries")).toBe(false);
  });
  it("pagina cards e comentários, mantendo etapa e organização", async () => {
    const data = await loadVentimaisExport(ORG, { format: "xlsx", stageFilter: { pipelineId: "pipeline-1", stageId: "novo" } });
    expect(data?.entries.map(e => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(data?.comments).toHaveLength(5);
    for (const call of calls.filter(c => ["pipeline_entries", "leads", "lead_comments"].includes(c.table))) {
      expect(call.filters).toContainEqual(["organization_id", ORG]);
    }
    for (const call of calls.filter(c => c.table === "pipeline_entries")) expect(call.filters).toContainEqual(["stage_key", "novo"]);
  });
  it("exporta o kanban inteiro e respeita limite de cards e seleção vazia", async () => {
    expect((await loadVentimaisExport(ORG, { format: "xlsx", pipelineId: "pipeline-1" }))?.entries).toHaveLength(5);
    expect((await loadVentimaisExport(ORG, { format: "xlsx", pipelineId: "pipeline-1", limit: 3 }))?.entries).toHaveLength(3);
    expect((await loadVentimaisExport(ORG, { format: "xlsx", pipelineId: "pipeline-1", leadIds: [] }))?.entries).toHaveLength(0);
  });
  it("erro ao buscar comentários interrompe a exportação", async () => {
    failures.add("lead_comments");
    await expect(loadVentimaisExport(ORG, { format: "xlsx", pipelineId: "pipeline-1" })).rejects.toThrow("falhou");
  });
  it("não retorna exportação parcial quando uma página falha", async () => {
    const page = vi.fn().mockResolvedValueOnce({ data: [1, 2], error: null }).mockResolvedValueOnce({ data: null, error: { message: "falha na página" } });
    await expect(readExportPages(page)).rejects.toThrow("falha na página");
  });
});
