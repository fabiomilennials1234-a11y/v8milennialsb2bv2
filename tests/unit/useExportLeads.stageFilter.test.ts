import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── Supabase mock — table-aware chain registry ─────────────────────────────
// SCRUM-635: o motor de export colapsou em pipeline_id — todo stageFilter
// resolve em `pipeline_entries` (fonte única pós-W3). Os fixtures abaixo
// refletem o novo contrato: `pipelines` + `pipeline_stages` são lidos sempre
// (cabeçalho dinâmico) e os slugs legados viram lookup em `pipelines`.
type AnyRow = Record<string, unknown>;

interface QueryRecord {
  table: string;
  selects: string[];
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
  ordered: boolean;
  limited: number | null;
}

const queries: QueryRecord[] = [];

const tableData = new Map<string, AnyRow[]>();

function setTableData(table: string, rows: AnyRow[]) {
  tableData.set(table, rows);
}

function buildChain(record: QueryRecord) {
  const exec = () =>
    Promise.resolve({ data: tableData.get(record.table) ?? [], error: null });

  const chain: Record<string, unknown> & PromiseLike<unknown> = {
    select(_cols: string) {
      record.selects.push(_cols);
      return chain;
    },
    eq(col: string, val: unknown) {
      record.eqs.push([col, val]);
      return chain;
    },
    in(col: string, vals: unknown[]) {
      record.ins.push([col, vals]);
      return chain;
    },
    order(_col: string) {
      record.ordered = true;
      return chain;
    },
    limit(n: number) {
      record.limited = n;
      // limit() is the terminal call for the leads query — return promise
      return exec();
    },
    then(resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) {
      return exec().then(resolve, reject);
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      const rec: QueryRecord = {
        table,
        selects: [],
        eqs: [],
        ins: [],
        ordered: false,
        limited: null,
      };
      queries.push(rec);
      return buildChain(rec);
    },
  },
}));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-123" }),
}));

vi.mock("@/modules/identity/permissions/lib/permissions", () => ({
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
  assertPermission: vi.fn().mockResolvedValue(undefined),
  assertIsAdmin: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/identity/auth/hooks/useIdentity", () => ({
  useIdentity: () => ({
    userId: "u1",
    organizationId: "org-123",
    teamMemberId: "tm-1",
    effectiveRole: "admin" as const,
    isMaster: false,
    isAdmin: true,
    features: {} as Record<string, boolean>,
    isLoading: false,
    isReady: true,
  }),
}));
vi.mock("@/modules/identity/permissions/hooks/useCanDo", () => ({
  useCanDo: () => ({ allowed: true, reason: "admin", isLoading: false }),
}));

// exceljs may not be installed in the test environment — only used by the
// xlsx branch, which our tests don't exercise. Stub to keep the import
// graph resolvable.
vi.mock("exceljs", () => ({
  default: {
    Workbook: class {
      addWorksheet() { return { addRow: () => {} }; }
      xlsx = { writeBuffer: async () => new ArrayBuffer(0) };
    },
  },
}));

const STAGE_UUID = "11111111-2222-4333-8444-555555555555";

/** Funis padrão dos testes: 1 system (whatsapp) + 1 custom. */
function seedFunnels() {
  setTableData("pipelines", [
    { id: "pl-w", name: "Oportunidades", slug: "whatsapp", type: "system" },
    { id: "pl-c", name: "Radar", slug: "radar", type: "custom" },
  ]);
  setTableData("pipeline_stages", [
    { id: STAGE_UUID, pipeline_id: "pl-w", stage_key: "novo", name: "Novo" },
  ]);
  setTableData("team_members", []);
}

// jsdom doesn't ship URL.createObjectURL — stub it so the CSV branch runs.
beforeEach(() => {
  queries.length = 0;
  tableData.clear();
  // @ts-expect-error — jsdom polyfill
  URL.createObjectURL = vi.fn(() => "blob://test");
  // @ts-expect-error — jsdom polyfill
  URL.revokeObjectURL = vi.fn();
  // Stub anchor.click() so it does nothing in test
  HTMLAnchorElement.prototype.click = vi.fn();
});

// Import after mocks so the hook captures the mocked supabase client
import { useExportLeads } from "@/modules/leads";

function findQueriesFor(table: string) {
  return queries.filter((q) => q.table === table);
}

describe("useExportLeads — stageFilter (motor único por pipeline_id, SCRUM-635/637)", () => {
  it("stage_key (formato legado de etapa): filtra pipeline_entries por stage_key", async () => {
    seedFunnels();
    setTableData("pipeline_entries", [{ lead_id: "L1" }, { lead_id: "L2" }, { lead_id: "L1" }]);
    setTableData("leads", [{ id: "L1", name: "Foo" }, { id: "L2", name: "Bar" }]);

    const { result } = renderHook(() => useExportLeads());

    let count = 0;
    await act(async () => {
      const r = await result.current.exportLeads({
        format: "csv",
        stageFilter: { pipelineId: "pl-w", stageId: "novo" },
        stageTitle: "Novo",
      });
      count = r.count;
    });

    const stageQ = findQueriesFor("pipeline_entries")[0];
    expect(stageQ).toBeDefined();
    expect(stageQ.eqs).toEqual(
      expect.arrayContaining([
        ["organization_id", "org-123"],
        ["pipeline_id", "pl-w"],
        ["stage_key", "novo"],
      ]),
    );

    // Leads query should have been called with .in("id", uniq([L1, L2]))
    const leadsQ = findQueriesFor("leads")[0];
    expect(leadsQ).toBeDefined();
    const inIdCall = leadsQ.ins.find(([col]) => col === "id");
    expect(inIdCall).toBeDefined();
    expect(new Set(inIdCall![1] as string[])).toEqual(new Set(["L1", "L2"]));
    expect(leadsQ.eqs).toEqual(expect.arrayContaining([["organization_id", "org-123"]]));

    expect(count).toBe(2);
  });

  it("etapa uuid: filtra por stage_id — serve funil custom igual (pl-c)", async () => {
    seedFunnels();
    setTableData("pipeline_entries", [{ lead_id: "C1" }]);
    setTableData("leads", [{ id: "C1", name: "Ix" }]);

    const { result } = renderHook(() => useExportLeads());
    await act(async () => {
      await result.current.exportLeads({
        format: "csv",
        stageFilter: { pipelineId: "pl-c", stageId: STAGE_UUID },
      });
    });

    const stageQ = findQueriesFor("pipeline_entries")[0];
    expect(stageQ).toBeDefined();
    expect(stageQ.eqs).toEqual(
      expect.arrayContaining([
        ["organization_id", "org-123"],
        ["pipeline_id", "pl-c"],
        ["stage_id", STAGE_UUID],
      ]),
    );
  });

  it("pipelineId endereça qualquer funil (canônico, SCRUM-633)", async () => {
    seedFunnels();
    setTableData("pipeline_entries", [{ lead_id: "P1" }]);
    setTableData("leads", [{ id: "P1", name: "Uni" }]);

    const { result } = renderHook(() => useExportLeads());
    await act(async () => {
      await result.current.exportLeads({
        format: "csv",
        stageFilter: { pipelineId: "pl-w", stageId: STAGE_UUID },
      });
    });

    const stageQ = findQueriesFor("pipeline_entries")[0];
    expect(stageQ.eqs).toEqual(
      expect.arrayContaining([
        ["pipeline_id", "pl-w"],
        ["stage_id", STAGE_UUID],
      ]),
    );
  });

  it("pipelineId ausente (chamador js sem tipo): lança em runtime", async () => {
    seedFunnels();
    const { result } = renderHook(() => useExportLeads());
    await expect(
      result.current.exportLeads({
        format: "csv",
        stageFilter: { stageId: STAGE_UUID } as never,
      }),
    ).rejects.toThrow(/pipelineId/);
  });

  it("returns { count: 0 } and skips leads query when stage is empty", async () => {
    seedFunnels();
    setTableData("pipeline_entries", []); // no entries in this stage
    setTableData("leads", [{ id: "should-not-appear" }]);

    const { result } = renderHook(() => useExportLeads());
    let res = { count: -1 };
    await act(async () => {
      res = await result.current.exportLeads({
        format: "csv",
        stageFilter: { pipelineId: "pl-w", stageId: "esfriou" },
      });
    });
    expect(res.count).toBe(0);
    // Did NOT query leads or team_members
    expect(findQueriesFor("leads").length).toBe(0);
    expect(findQueriesFor("team_members").length).toBe(0);
  });

  it("without stageFilter: preserves global behaviour (no stage prefilter, leads query runs)", async () => {
    seedFunnels();
    setTableData("pipeline_entries", []);
    setTableData("leads", [{ id: "G1" }, { id: "G2" }]);

    const { result } = renderHook(() => useExportLeads());
    await act(async () => {
      await result.current.exportLeads({ format: "csv" });
    });

    const leadsQ = findQueriesFor("leads")[0];
    expect(leadsQ).toBeDefined();
    expect(leadsQ.eqs).toEqual(expect.arrayContaining([["organization_id", "org-123"]]));
    // No .in("id", ...) added when stageFilter absent
    expect(leadsQ.ins.find(([c]) => c === "id")).toBeUndefined();
    // Entries de TODOS os funis são lidas por lote de leads (cabeçalho dinâmico)
    const batchQ = findQueriesFor("pipeline_entries")[0];
    expect(batchQ).toBeDefined();
    expect(batchQ.ins.find(([c]) => c === "lead_id")).toBeDefined();
  });
});
