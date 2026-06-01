import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── Supabase mock — table-aware chain registry ─────────────────────────────
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

// Per-table fixtures keyed on filter conjunction so different tests can
// override the dataset for the same table without mutual interference.
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

vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-123" }),
}));

vi.mock("@/modules/identity/lib/permissions", () => ({
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
vi.mock("@/modules/identity/hooks/useCanDo", () => ({
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

describe("useExportLeads — stageFilter", () => {
  it("pipe=whatsapp: filters pipe_whatsapp by status + organization_id, then leads .in(id, [...])", async () => {
    setTableData("pipe_whatsapp", [{ lead_id: "L1" }, { lead_id: "L2" }, { lead_id: "L1" }]);
    setTableData("leads", [{ id: "L1", name: "Foo" }, { id: "L2", name: "Bar" }]);
    setTableData("team_members", []);
    setTableData("pipe_confirmacao", []);
    setTableData("pipe_propostas", []);

    const { result } = renderHook(() => useExportLeads());

    let count = 0;
    await act(async () => {
      const r = await result.current.exportLeads({
        format: "csv",
        stageFilter: { pipe: "whatsapp", stageId: "novo" },
        stageTitle: "Novo",
      });
      count = r.count;
    });

    const stageQ = findQueriesFor("pipe_whatsapp")[0];
    expect(stageQ).toBeDefined();
    expect(stageQ.eqs).toEqual(
      expect.arrayContaining([
        ["organization_id", "org-123"],
        ["status", "novo"],
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

  it("pipe=confirmacao: filters pipe_confirmacao by status", async () => {
    setTableData("pipe_confirmacao", [{ lead_id: "L9" }]);
    setTableData("leads", [{ id: "L9", name: "Baz" }]);
    setTableData("team_members", []);
    setTableData("pipe_whatsapp", []);
    setTableData("pipe_propostas", []);

    const { result } = renderHook(() => useExportLeads());
    await act(async () => {
      await result.current.exportLeads({
        format: "csv",
        stageFilter: { pipe: "confirmacao", stageId: "reuniao_marcada" },
      });
    });

    const stageQ = findQueriesFor("pipe_confirmacao")[0];
    expect(stageQ.eqs).toEqual(
      expect.arrayContaining([
        ["organization_id", "org-123"],
        ["status", "reuniao_marcada"],
      ]),
    );
  });

  it("pipe=propostas: filters pipe_propostas by status", async () => {
    setTableData("pipe_propostas", [{ lead_id: "L3" }]);
    setTableData("leads", [{ id: "L3", name: "Qux" }]);
    setTableData("team_members", []);
    setTableData("pipe_whatsapp", []);
    setTableData("pipe_confirmacao", []);

    const { result } = renderHook(() => useExportLeads());
    await act(async () => {
      await result.current.exportLeads({
        format: "csv",
        stageFilter: { pipe: "propostas", stageId: "vendido" },
      });
    });

    const stageQ = findQueriesFor("pipe_propostas")[0];
    expect(stageQ.eqs).toEqual(
      expect.arrayContaining([
        ["organization_id", "org-123"],
        ["status", "vendido"],
      ]),
    );
  });

  it("pipe=custom: queries custom_pipe_entries with pipeline_id + stage_id + organization_id", async () => {
    setTableData("custom_pipe_entries", [{ lead_id: "C1" }]);
    setTableData("leads", [{ id: "C1", name: "Ix" }]);
    setTableData("team_members", []);
    setTableData("pipe_whatsapp", []);
    setTableData("pipe_confirmacao", []);
    setTableData("pipe_propostas", []);

    const { result } = renderHook(() => useExportLeads());
    await act(async () => {
      await result.current.exportLeads({
        format: "csv",
        stageFilter: {
          pipe: "custom",
          stageId: "stage-uuid-1",
          customPipelineId: "pipeline-uuid-1",
        },
      });
    });

    const stageQ = findQueriesFor("custom_pipe_entries")[0];
    expect(stageQ).toBeDefined();
    expect(stageQ.eqs).toEqual(
      expect.arrayContaining([
        ["organization_id", "org-123"],
        ["pipeline_id", "pipeline-uuid-1"],
        ["stage_id", "stage-uuid-1"],
      ]),
    );
  });

  it("pipe=custom: throws when customPipelineId is missing", async () => {
    const { result } = renderHook(() => useExportLeads());
    await expect(
      result.current.exportLeads({
        format: "csv",
        stageFilter: { pipe: "custom", stageId: "stage-x" },
      }),
    ).rejects.toThrow(/customPipelineId/);
  });

  it("returns { count: 0 } and skips leads query when stage is empty", async () => {
    setTableData("pipe_whatsapp", []); // no entries in this stage
    setTableData("leads", [{ id: "should-not-appear" }]);

    const { result } = renderHook(() => useExportLeads());
    let res = { count: -1 };
    await act(async () => {
      res = await result.current.exportLeads({
        format: "csv",
        stageFilter: { pipe: "whatsapp", stageId: "esfriou" },
      });
    });
    expect(res.count).toBe(0);
    // Did NOT query leads or any other tables
    expect(findQueriesFor("leads").length).toBe(0);
    expect(findQueriesFor("team_members").length).toBe(0);
  });

  it("without stageFilter: preserves global behaviour (no stage prefilter, leads query runs)", async () => {
    setTableData("leads", [{ id: "G1" }, { id: "G2" }]);
    setTableData("team_members", []);
    setTableData("pipe_whatsapp", []);
    setTableData("pipe_confirmacao", []);
    setTableData("pipe_propostas", []);

    const { result } = renderHook(() => useExportLeads());
    await act(async () => {
      await result.current.exportLeads({ format: "csv" });
    });

    // No stage prefilter query: pipe_whatsapp/confirmacao/propostas only
    // appear inside the per-batch lead-id loop, NOT before leads.
    const leadsQ = findQueriesFor("leads")[0];
    expect(leadsQ).toBeDefined();
    expect(leadsQ.eqs).toEqual(expect.arrayContaining([["organization_id", "org-123"]]));
    // No .in("id", ...) added when stageFilter absent
    expect(leadsQ.ins.find(([c]) => c === "id")).toBeUndefined();
  });
});
