/**
 * Regression: duplicate key value violates unique constraint
 * "idx_pipeline_entries_pipeline_lead" when (pipeline_id, lead_id) already exists.
 *
 * useCreatePipeProposta must be idempotent: existing entry returned, no insert.
 * On 23505 race, hook must fetch and return existing instead of throwing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

const ORG_ID = "org-1";
const PIPELINE_ID = "pipeline-propostas-1";
const LEAD_ID = "lead-ana";

vi.mock("@/modules/identity/hooks/useOrganization", () => ({
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

vi.mock("@/modules/pipelines/hooks/usePipelineEntries", async () => {
  const actual = await vi.importActual<any>("@/modules/pipelines/hooks/usePipelineEntries");
  return {
    ...actual,
    usePipelineId: () => ({ data: PIPELINE_ID }),
    usePipelineEntries: () => ({ data: [] }),
  };
});

vi.mock("@/modules/identity/lib/permissions", () => ({
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
}));

vi.mock("@/hooks/useAutoFollowUp", () => ({
  triggerFollowUpAutomation: vi.fn().mockResolvedValue(undefined),
}));

const mockMaybeSingle = vi.fn();
const mockInsertSingle = vi.fn();

const buildChain = () => {
  const chain: any = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = mockMaybeSingle;
  chain.single = mockInsertSingle;
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  return chain;
};

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

import { useCreatePipeProposta } from "@/modules/pipelines/hooks/usePipePropostas";

beforeEach(() => {
  mockMaybeSingle.mockReset();
  mockInsertSingle.mockReset();
  mockFrom.mockClear();
});

describe("useCreatePipeProposta — idempotent create", () => {
  it("inserts a new pipeline_entries row when none exists for (pipeline_id, lead_id)", async () => {
    // Pre-check: no existing entry
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
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
    };
    // Pre-check returns existing
    mockMaybeSingle.mockResolvedValueOnce({ data: existing, error: null });
    // Insert MUST NOT be called; ensure single resolves anyway to detect calls
    mockInsertSingle.mockResolvedValueOnce({ data: { id: "should-not-be-used" }, error: null });

    const { result } = renderHook(() => useCreatePipeProposta(), { wrapper: createWrapper() });

    const got = await result.current.mutateAsync({ lead_id: LEAD_ID });
    expect(got.id).toBe("entry-existing");
    // assert insert chain was NOT invoked
    const insertCalls = mockFrom.mock.results
      .map((r: any) => r.value)
      .filter((c: any) => c.insert.mock.calls.length > 0);
    expect(insertCalls.length).toBe(0);
  });

  it("recovers from 23505 race by fetching and returning the existing entry", async () => {
    const existing = {
      id: "entry-after-race",
      pipeline_id: PIPELINE_ID,
      lead_id: LEAD_ID,
      stage_key: "marcar_compromisso",
      organization_id: ORG_ID,
    };
    // First pre-check: no entry (so we attempt insert)
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    // Insert blows up with 23505 (concurrent inserter won)
    mockInsertSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "idx_pipeline_entries_pipeline_lead"' },
    });
    // Post-error fallback fetch: returns existing
    mockMaybeSingle.mockResolvedValueOnce({ data: existing, error: null });

    const { result } = renderHook(() => useCreatePipeProposta(), { wrapper: createWrapper() });

    const got = await result.current.mutateAsync({ lead_id: LEAD_ID });
    expect(got.id).toBe("entry-after-race");
  });
});
