/**
 * Batch test 2+3 — bulk hook coverage via initialization tests.
 * Uses vi.hoisted() to avoid mock hoisting issues.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

// Factory-only mocks (no external references)
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, any> = {};
  const methods = ["select","eq","neq","or","in","gte","lte","lt","ilike","contains","order","limit","range","insert","update","delete","upsert"];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.then = (fn: any) => Promise.resolve(fn({ data: [], error: null, count: 0 }));
  return {
    supabase: {
      from: vi.fn().mockReturnValue(chain),
      channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
      removeChannel: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }), onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }) },
      storage: { from: vi.fn().mockReturnValue({ upload: vi.fn(), getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }) }) },
    },
  };
});

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: {} }) }));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-test", isReady: true }), useRequiredOrganization: () => ({ organizationId: "org-test", teamMemberId: "tm1" }) }));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({ useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-test", user_id: "u1", role: "admin" } }), isVirtualTeamMember: () => false, useTeamMembers: () => ({ data: [] }) }));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false }) }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/pipelines/hooks/model/usePipelineStages", () => ({ usePipelineStages: () => ({ data: [] }), DEFAULT_STAGES: {} }));
vi.mock("@/modules/leads/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/modules/copilot/hooks/useCopilotPromptBuilder", () => ({ generatePrompt: vi.fn(), saveCopilotSystemPrompt: vi.fn(), regenerateAndSavePrompt: vi.fn(), computePromptHash: vi.fn() }));
vi.mock("@/modules/copilot/hooks/useAgentFollowupRules", () => ({ followupRuleToDB: vi.fn((r: any) => r) }));
vi.mock("@/modules/workflows/hooks/useAutoFollowUp", () => ({ triggerFollowUpAutomation: vi.fn() }));
vi.mock("@/lib/workflowTrigger", () => ({ triggerLeadCreatedInCustomPipeline: vi.fn() }));
vi.mock("@/modules/identity/permissions/lib/permissions", () => ({ assertIsAdmin: vi.fn(), useCanPerformActionAsync: () => vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/copilot/custom-instructions-utils", () => ({ parseCustomInstructions: () => ({ dos: "", donts: "" }), serializeCustomInstructions: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

// ── Hook imports ──
import { useAwards } from "@/modules/engagement/hooks/useAwards";
import { useBadges } from "@/modules/engagement/hooks/useBadges";
import { useCompetitions } from "@/modules/engagement/hooks/useCompetitions";
import { useProfiles } from "@/modules/identity/org-team/hooks/useProfiles";
import { useCountUp } from "@/shared/hooks/useCountUp";
import { useLeadTimeline } from "@/modules/leads";
import { useLogger } from "@/modules/platform/hooks/useLogger";
import { useMasterPlans } from "@/modules/identity/master/hooks/useMasterPlans";
import { useMessageTemplates } from "@/modules/communication/hooks/useMessageTemplates";
import { useOrgSwitcher } from "@/modules/identity/org-team/hooks/useOrgSwitcher";
import { useOrganizationSettings } from "@/modules/identity/org-team/hooks/useOrganizationSettings";
import { useMasterOrganizations } from "@/modules/identity/master/hooks/useMasterOrganizations";
import { useMasterUsers } from "@/modules/identity/master/hooks/useMasterUsers";
import { useMasterAuditLogs } from "@/modules/identity/master/hooks/useMasterAuditLogs";
import { useAvatarMap } from "@/modules/identity/hooks/useAvatarMap";
import { useAutoAdminAssignment } from "@/modules/identity/hooks/useAutoAdminAssignment";
import { useDailyPriorities } from "@/modules/engagement/hooks/useDailyPriorities";
import { useDashboardMetrics } from "@/modules/analytics/hooks/useDashboardMetrics";
import { useScheduledMessages } from "@/modules/communication/hooks/useScheduledMessages";
import { useOutboundMetrics } from "@/modules/analytics/hooks/useOutboundMetrics";
import { useWhatsAppInstances } from "@/modules/communication/hooks/useWhatsAppInstances";
import { useProductRanking } from "@/modules/carteira/hooks/useProductRanking";

// ── Tests ──
const hooks: [string, () => any][] = [
  ["useAwards", () => useAwards()],
  ["useBadges", () => useBadges()],
  ["useCompetitions", () => useCompetitions()],
  ["useProfiles", () => useProfiles()],
  ["useLeadTimeline", () => useLeadTimeline("lead-1")],
  ["useLogger", () => useLogger()],
  ["useMasterPlans", () => useMasterPlans()],
  ["useMessageTemplates", () => useMessageTemplates()],
  ["useOrgSwitcher", () => useOrgSwitcher()],
  ["useOrganizationSettings", () => useOrganizationSettings()],
  ["useMasterOrganizations", () => useMasterOrganizations()],
  ["useMasterUsers", () => useMasterUsers()],
  ["useMasterAuditLogs", () => useMasterAuditLogs()],
  ["useAutoAdminAssignment", () => useAutoAdminAssignment()],
  ["useDailyPriorities", () => useDailyPriorities()],
  ["useDashboardMetrics", () => useDashboardMetrics()],
  // useScheduledMessages has complex side effects — tested separately
  // ["useScheduledMessages", () => useScheduledMessages()],
  ["useOutboundMetrics", () => useOutboundMetrics()],
  ["useWhatsAppInstances", () => useWhatsAppInstances()],
  ["useProductRanking", () => useProductRanking()],
];

describe.each(hooks)("%s", (_name, hookFn) => {
  it("initializes without error", () => {
    expect(() => renderHook(() => hookFn(), { wrapper: createWrapper() })).not.toThrow();
  });
});

describe("useCountUp", () => {
  it("returns a number", () => {
    const { result } = renderHook(() => useCountUp(100, 0), { wrapper: createWrapper() });
    expect(typeof result.current).toBe("number");
  });
});

describe("useAvatarMap", () => {
  it("accepts member IDs", () => {
    const { result } = renderHook(() => useAvatarMap(["m1", "m2"]), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });
});
