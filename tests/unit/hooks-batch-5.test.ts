/**
 * Batch 5 — analytics, upsell, pipe, tinyerp, and remaining hooks
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

vi.mock("@/integrations/supabase/client", () => {
  const c: Record<string, any> = {};
  ["select","eq","neq","or","in","gte","lte","lt","ilike","contains","order","limit","range","insert","update","delete","upsert","not","is","filter","textSearch","match"].forEach(m => c[m] = vi.fn().mockReturnValue(c));
  c.single = vi.fn().mockResolvedValue({ data: null, error: null });
  c.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  c.then = (fn: any) => Promise.resolve(fn({ data: [], error: null, count: 0 }));
  return {
    supabase: {
      from: vi.fn().mockReturnValue(c),
      channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
      removeChannel: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }), onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }) },
      storage: { from: vi.fn().mockReturnValue({ upload: vi.fn(), getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }), remove: vi.fn() }) },
    },
  };
});

vi.mock("@/modules/identity/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: {} }) }));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-t", isReady: true }), useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }) }));
vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({ useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t", user_id: "u1", role: "admin" } }), isVirtualTeamMember: () => false, useTeamMembers: () => ({ data: [] }) }));
vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false }) }));
vi.mock("@/hooks/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/pipelines/hooks/usePipelineStages", () => ({ usePipelineStages: () => ({ data: [] }), DEFAULT_STAGES: {} }));
vi.mock("@/modules/leads/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/hooks/useAutoFollowUp", () => ({ triggerFollowUpAutomation: vi.fn() }));
vi.mock("@/lib/workflowTrigger", () => ({ triggerStageChangedWorkflows: vi.fn(), triggerLeadCreatedInCustomPipeline: vi.fn() }));
vi.mock("@/modules/identity/lib/permissions", () => ({ assertIsAdmin: vi.fn(), useCanPerformActionAsync: () => vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/hooks/useProducts", () => ({ useProducts: () => ({ data: [] }) }));

// ── Imports ──
import { useAnalyticsComercial } from "@/hooks/useAnalyticsComercial";
import { useAnalyticsEngajamento } from "@/hooks/useAnalyticsEngajamento";
import { useAnalyticsFilters } from "@/hooks/useAnalyticsFilters";
import { useAnalyticsFinanceiro } from "@/hooks/useAnalyticsFinanceiro";
import { useAnalyticsOverview } from "@/hooks/useAnalyticsOverview";
import { useAnalyticsPipesFunis } from "@/hooks/useAnalyticsPipesFunis";
import { useAnalyticsUtms } from "@/hooks/useAnalyticsUtms";
import { useUpsellClients } from "@/hooks/useUpsellClients";
import { useUpsellMetrics } from "@/hooks/useUpsellMetrics";
import { useUpsellOrders } from "@/hooks/useUpsellOrders";
import { useUpsellGestaoRules } from "@/hooks/useUpsellGestaoRules";
import { useUpsellCampanhas } from "@/hooks/useUpsellCampanhas";
import { useUpsellClientProducts } from "@/hooks/useUpsellClientProducts";
import { usePipeDispatchRules } from "@/modules/pipelines/hooks/usePipeDispatchRules";
import { usePipeDistribution } from "@/modules/pipelines/hooks/usePipeDistribution";
import { usePipePropostaItems } from "@/modules/pipelines/hooks/usePipePropostaItems";
import { usePipelineDisplayConfig } from "@/modules/pipelines/hooks/usePipelineDisplayConfig";
import { useProductVariants } from "@/hooks/useProductVariants";
// useSupportMaterials doesn't exist

// Analytics hooks use RPC — safe with mock
const analyticsHooks: [string, () => any][] = [
  ["useAnalyticsComercial", () => useAnalyticsComercial({ startDate: "2026-01-01", endDate: "2026-01-31" })],
  ["useAnalyticsEngajamento", () => useAnalyticsEngajamento({ startDate: "2026-01-01", endDate: "2026-01-31" })],
  ["useAnalyticsFinanceiro", () => useAnalyticsFinanceiro({ startDate: "2026-01-01", endDate: "2026-01-31" })],
  ["useAnalyticsOverview", () => useAnalyticsOverview({ startDate: "2026-01-01", endDate: "2026-01-31" })],
  ["useAnalyticsPipesFunis", () => useAnalyticsPipesFunis({ startDate: "2026-01-01", endDate: "2026-01-31" })],
  ["useAnalyticsUtms", () => useAnalyticsUtms({ startDate: "2026-01-01", endDate: "2026-01-31" })],
];

describe.each(analyticsHooks)("%s", (_name, hookFn) => {
  it("initializes", () => {
    expect(() => renderHook(() => hookFn(), { wrapper: createWrapper() })).not.toThrow();
  });
});

describe("useAnalyticsFilters", () => {
  it("initializes", () => {
    expect(() => renderHook(() => useAnalyticsFilters(), { wrapper: createWrapper() })).not.toThrow();
  });
});

// Upsell hooks
const upsellHooks: [string, () => any][] = [
  ["useUpsellClients", () => useUpsellClients()],
  ["useUpsellMetrics", () => useUpsellMetrics()],
  ["useUpsellOrders", () => useUpsellOrders("lead-1")],
  ["useUpsellGestaoRules", () => useUpsellGestaoRules()],
  ["useUpsellCampanhas", () => useUpsellCampanhas()],
  ["useUpsellClientProducts", () => useUpsellClientProducts()],
];

describe.each(upsellHooks)("%s", (_name, hookFn) => {
  it("initializes", () => {
    expect(() => renderHook(() => hookFn(), { wrapper: createWrapper() })).not.toThrow();
  });
});

// Pipe hooks
const pipeHooks: [string, () => any][] = [
  ["usePipeDispatchRules", () => usePipeDispatchRules()],
  // usePipeDistribution has complex side effects
  ["usePipePropostaItems", () => usePipePropostaItems("lead-1")],
  ["usePipelineDisplayConfig", () => usePipelineDisplayConfig()],
  ["useProductVariants", () => useProductVariants("prod-1")],
  // useSupportMaterials removed (doesn't exist)
];

describe.each(pipeHooks)("%s", (_name, hookFn) => {
  it("initializes", () => {
    expect(() => renderHook(() => hookFn(), { wrapper: createWrapper() })).not.toThrow();
  });
});
