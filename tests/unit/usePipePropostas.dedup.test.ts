/**
 * Regression: duplicate key value violates unique constraint
 * "idx_pipeline_entries_pipeline_lead" when (pipeline_id, lead_id) already exists.
 *
 * useCreatePipeProposta must be idempotent: existing entry returned, no insert.
 * On 23505 race, hook must fetch and return existing instead of throwing.
 *
 * ---
 * ⚠️ Reescrito em 2026-07-31. Por quê, sem eufemismo:
 *
 * A versão anterior mockava `.maybeSingle()` e, com isso, **codificava como
 * requisito exatamente o mecanismo que quebra**. O mock devolvia sempre uma linha
 * ou nenhuma, então os três testes passavam verdes enquanto o caminho real, com
 * duas linhas, duplicava: o postgrest-js zera o `data` e devolve `PGRST116`
 * quando `maybeSingle()` casa mais de uma linha
 * (`node_modules/@supabase/postgrest-js/dist/index.mjs:107-119`), o código lia
 * isso como "não existe" e inseria de novo. Teste verde sobre produção duplicando.
 *
 * O mock não podia expressar esse caso porque `.maybeSingle()` não tem como
 * devolver "duas linhas" — a forma do mock escondia a forma do bug. Agora o mock
 * resolve na `.limit()` e devolve **arrays**, que é o que a query real devolve, e
 * o caso de 2 linhas virou teste de primeira classe (`não insere quando já existem
 * DUAS entries`) — o cenário que o M1 torna possível ao derrubar os uniques.
 *
 * "Idempotente" continua sendo o requisito, mas com escopo honesto: vale para
 * chamada SEQUENCIAL. Concorrência é garantida pelo unique do banco hoje, e deixa
 * de ser depois do M1 — ver o comentário de `findOrCreatePipelineEntry`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

const ORG_ID = "org-1";
const PIPELINE_ID = "pipeline-propostas-1";
const LEAD_ID = "lead-ana";

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({
    organizationId: ORG_ID,
    teamMemberId: "tm-1",
    role: "admin",
    orgType: "crm",
    isLoading: false,
    isReady: true,
    error: null,
  }),
}));

vi.mock("@/modules/pipelines/hooks/model/usePipelineEntries", async () => {
  const actual = await vi.importActual<any>("@/modules/pipelines/hooks/model/usePipelineEntries");
  return {
    ...actual,
    usePipelineId: () => ({ data: PIPELINE_ID }),
    usePipelineEntries: () => ({ data: [] }),
  };
});

vi.mock("@/modules/identity/permissions/lib/permissions", () => ({
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
}));

vi.mock("@/modules/workflows/hooks/useAutoFollowUp", () => ({
  triggerFollowUpAutomation: vi.fn().mockResolvedValue(undefined),
}));

// Resolve a leitura de pipeline_entries. Devolve `{ data: Row[] }` — array, como a
// query real, porque a leitura agora tolera N linhas em vez de `.maybeSingle()`.
const mockSelectRows = vi.fn();
const mockInsertSingle = vi.fn();

const buildChain = () => {
  const chain: any = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = mockSelectRows;
  chain.single = mockInsertSingle;
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  return chain;
};

const insertCallCount = () =>
  mockFrom.mock.results
    .map((r: any) => r.value)
    .filter((c: any) => c.insert.mock.calls.length > 0).length;

const mockFrom = vi.fn(() => buildChain());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: any[]) => mockFrom(...a),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

import { useCreatePipeProposta } from "@/modules/pipelines/hooks/legacy/usePipePropostas";

beforeEach(() => {
  mockSelectRows.mockReset();
  mockInsertSingle.mockReset();
  mockFrom.mockClear();
});

describe("useCreatePipeProposta — idempotent create", () => {
  it("inserts a new pipeline_entries row when none exists for (pipeline_id, lead_id)", async () => {
    // Pre-check: no existing entry
    mockSelectRows.mockResolvedValueOnce({ data: [], error: null });
    // Insert returns the new row
    const newRow = {
      id: "entry-new",
      pipeline_id: PIPELINE_ID,
      lead_id: LEAD_ID,
      stage_key: "marcar_compromisso",
      organization_id: ORG_ID,
    };
    mockInsertSingle.mockResolvedValueOnce({ data: newRow, error: null });

    const { result } = renderHook(() => useCreatePipeProposta(), { wrapper: createWrapper() });

    const created = await result.current.mutateAsync({ lead_id: LEAD_ID });
    expect(created.id).toBe("entry-new");
    expect(mockFrom).toHaveBeenCalledWith("pipeline_entries");
  });

  it("returns the existing entry when one already exists for (pipeline_id, lead_id)", async () => {
    const existing = {
      id: "entry-existing",
      pipeline_id: PIPELINE_ID,
      lead_id: LEAD_ID,
      stage_key: "compromisso_marcado",
      organization_id: ORG_ID,
      closed_at: null,
    };
    // Pre-check returns existing
    mockSelectRows.mockResolvedValueOnce({ data: [existing], error: null });
    // Insert MUST NOT be called; ensure single resolves anyway to detect calls
    mockInsertSingle.mockResolvedValueOnce({ data: { id: "should-not-be-used" }, error: null });

    const { result } = renderHook(() => useCreatePipeProposta(), { wrapper: createWrapper() });

    const got = await result.current.mutateAsync({ lead_id: LEAD_ID });
    expect(got.id).toBe("entry-existing");
    expect(insertCallCount()).toBe(0);
  });

  /**
   * O caso que o M1 destrava e que o teste anterior NÃO conseguia expressar.
   *
   * Com os uniques no lugar isto é inalcançável — por isso é teste de regressão
   * antecipada, não descrição do presente. Sem a correção, `.maybeSingle()` com 2
   * linhas devolve `data: null` + `PGRST116`, o código lê "não existe" e insere a
   * terceira. Com a correção, a leitura devolve as duas, escolhe uma e não insere.
   *
   * A escolhida é a ABERTA (`closed_at: null`), mesmo ela não sendo a primeira do
   * array: um negócio já ganho/perdido não é o que o usuário está trabalhando.
   */
  it("não insere quando já existem DUAS entries e devolve a aberta (cenário pós-M1)", async () => {
    const fechada = {
      id: "entry-vendida",
      pipeline_id: PIPELINE_ID,
      lead_id: LEAD_ID,
      stage_key: "vendido",
      organization_id: ORG_ID,
      closed_at: "2026-07-30T12:00:00Z",
    };
    const aberta = {
      id: "entry-aberta",
      pipeline_id: PIPELINE_ID,
      lead_id: LEAD_ID,
      stage_key: "marcar_compromisso",
      organization_id: ORG_ID,
      closed_at: null,
    };
    mockSelectRows.mockResolvedValueOnce({ data: [fechada, aberta], error: null });
    mockInsertSingle.mockResolvedValueOnce({ data: { id: "nunca-deveria-inserir" }, error: null });

    const { result } = renderHook(() => useCreatePipeProposta(), { wrapper: createWrapper() });

    const got = await result.current.mutateAsync({ lead_id: LEAD_ID });
    expect(got.id).toBe("entry-aberta");
    expect(insertCallCount()).toBe(0);
  });

  /**
   * Erro de leitura não pode virar "não existe" — era isso que o
   * `const { data: existing } = …` fazia ao descartar o error. Hoje o unique
   * absorve o estrago; depois do M1 viraria negócio duplicado a cada falha
   * transitória. Mudança de comportamento deliberada: levanta em vez de inserir.
   */
  it("propaga erro de leitura em vez de inserir às cegas", async () => {
    mockSelectRows.mockResolvedValueOnce({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    mockInsertSingle.mockResolvedValueOnce({ data: { id: "nunca-deveria-inserir" }, error: null });

    const { result } = renderHook(() => useCreatePipeProposta(), { wrapper: createWrapper() });

    await expect(result.current.mutateAsync({ lead_id: LEAD_ID })).rejects.toMatchObject({
      code: "57014",
    });
    expect(insertCallCount()).toBe(0);
  });

  it("recovers from 23505 race by fetching and returning the existing entry", async () => {
    const existing = {
      id: "entry-after-race",
      pipeline_id: PIPELINE_ID,
      lead_id: LEAD_ID,
      stage_key: "marcar_compromisso",
      organization_id: ORG_ID,
      closed_at: null,
    };
    // First pre-check: no entry (so we attempt insert)
    mockSelectRows.mockResolvedValueOnce({ data: [], error: null });
    // Insert blows up with 23505 (concurrent inserter won)
    mockInsertSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "idx_pipeline_entries_pipeline_lead"' },
    });
    // Post-error fallback fetch: returns existing
    mockSelectRows.mockResolvedValueOnce({ data: [existing], error: null });

    const { result } = renderHook(() => useCreatePipeProposta(), { wrapper: createWrapper() });

    const got = await result.current.mutateAsync({ lead_id: LEAD_ID });
    expect(got.id).toBe("entry-after-race");
  });
});
