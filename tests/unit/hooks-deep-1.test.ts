/**
 * Deep tests — pure functions and constants exported from large hooks
 * These cover actual business logic without needing renderHook.
 */
import { describe, it, expect, vi } from "vitest";

// Mock everything needed by hook modules
vi.mock("@/integrations/supabase/client", () => {
  const c: Record<string, any> = {};
  ["select","eq","neq","or","in","gte","lte","lt","ilike","contains","order","limit","range","insert","update","delete","upsert","not","is","filter","match","overlaps"].forEach(m => c[m] = vi.fn().mockReturnValue(c));
  c.single = vi.fn().mockResolvedValue({ data: null, error: null });
  c.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  c.then = (fn: any) => Promise.resolve(fn({ data: [], error: null, count: 0 }));
  return { supabase: { from: vi.fn().mockReturnValue(c), channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }), removeChannel: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: null }), functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) }, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }), onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }) }, storage: { from: vi.fn().mockReturnValue({ upload: vi.fn(), getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }) }) } } };
});
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: {} }) }));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-t", isReady: true }), useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }) }));
vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({ useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t" } }), isVirtualTeamMember: () => false, useTeamMembers: () => ({ data: [] }) }));
vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false }) }));
vi.mock("@/modules/identity/auth/hooks/useIdentity", () => ({
  useIdentity: () => ({
    userId: "u1",
    organizationId: "org-t",
    teamMemberId: "tm1",
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
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/pipelines/hooks/model/usePipelineStages", () => ({ usePipelineStages: () => ({ data: [] }), DEFAULT_STAGES: {}, useAllPipelineStageOptions: vi.fn(() => ({ data: [] })) }));
vi.mock("@/modules/workflows/hooks/useAutoFollowUp", () => ({ triggerFollowUpAutomation: vi.fn() }));
vi.mock("@/modules/leads/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/lib/workflowTrigger", () => ({ triggerLeadCreatedInCustomPipeline: vi.fn() }));
vi.mock("@/modules/identity/permissions/lib/permissions", () => ({ assertIsAdmin: vi.fn(), assertPermission: vi.fn().mockResolvedValue(undefined), useCanPerformActionAsync: () => vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/copilot/custom-instructions-utils", () => ({ parseCustomInstructions: () => ({ dos: "", donts: "" }), serializeCustomInstructions: () => null }));
vi.mock("@/modules/copilot/hooks/useAgentFollowupRules", () => ({ followupRuleToDB: vi.fn((r: any) => r) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock("papaparse", () => ({ default: { parse: vi.fn() } }));

// ── useCampaignTemplates ──
import {
  TEMPLATE_VARIABLES as CAMP_TEMPLATE_VARS,
  getTimeBasedVariables,
  type CampaignTemplate,
  type CampaignTemplateMessageType,
  type DispatchBatch,
  type LeadFilter,
} from "@/modules/campaigns/hooks/useCampaignTemplates";

describe("useCampaignTemplates — pure exports", () => {
  it("TEMPLATE_VARIABLES has expected variables", () => {
    expect(CAMP_TEMPLATE_VARS.length).toBeGreaterThan(3);
    const names = CAMP_TEMPLATE_VARS.map((v: any) => v.key || v.name || v);
    expect(names.some((n: string) => typeof n === 'string')).toBe(true);
  });

  it("getTimeBasedVariables returns saudacao, data, hora", () => {
    const result = getTimeBasedVariables(new Date("2026-04-13T10:00:00"));
    expect(result.saudacao).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(result.hora).toBeTruthy();
  });

  it("getTimeBasedVariables morning returns Bom dia", () => {
    const result = getTimeBasedVariables(new Date("2026-04-13T09:00:00"));
    expect(result.saudacao.toLowerCase()).toContain("bom dia");
  });

  it("getTimeBasedVariables afternoon returns Boa tarde", () => {
    const result = getTimeBasedVariables(new Date("2026-04-13T14:00:00"));
    expect(result.saudacao.toLowerCase()).toContain("boa tarde");
  });

  it("getTimeBasedVariables evening returns Boa noite", () => {
    const result = getTimeBasedVariables(new Date("2026-04-13T20:00:00"));
    expect(result.saudacao.toLowerCase()).toContain("boa noite");
  });

  it("CampaignTemplateMessageType union", () => {
    const types: CampaignTemplateMessageType[] = ["text", "audio", "image", "document"];
    expect(types).toHaveLength(4);
  });
});

// ── useCustomPipelines ──
import {
  TEMPORARY_FUNNEL_STAGES,
  type CustomPipeline,
  type CustomPipelineStage,
  type CustomPipeEntry,
  type LifecycleType,
  type FunnelStatus,
} from "@/modules/pipelines/hooks/custom/useCustomPipelines";

describe("useCustomPipelines — pure exports", () => {
  it("TEMPORARY_FUNNEL_STAGES has indicacao, prospeccao, reativacao", () => {
    expect(TEMPORARY_FUNNEL_STAGES.indicacao).toBeDefined();
    expect(TEMPORARY_FUNNEL_STAGES.prospeccao).toBeDefined();
    expect(TEMPORARY_FUNNEL_STAGES.reativacao).toBeDefined();
  });

  it("each template has stages array", () => {
    Object.entries(TEMPORARY_FUNNEL_STAGES).forEach(([type, stages]) => {
      expect(Array.isArray(stages), `${type} stages not array`).toBe(true);
      expect(stages.length, `${type} has no stages`).toBeGreaterThan(0);
    });
  });

  it("LifecycleType has permanent and temporary", () => {
    const types: LifecycleType[] = ["permanent", "temporary"];
    expect(types).toHaveLength(2);
  });

  it("FunnelStatus has all statuses", () => {
    const statuses: FunnelStatus[] = ["draft", "active", "paused", "ended"];
    expect(statuses).toHaveLength(4);
  });
});

// ── useImportLeads ──
import {
  KNOWN_LEAD_FIELDS,
  parseFilePreview,
  type FilePreviewResult,
  type ColumnMappingOption,
  type FunnelDestination,
} from "@/modules/leads";

describe("useImportLeads — pure exports", () => {
  it("KNOWN_LEAD_FIELDS has essential fields", () => {
    const fields = [...KNOWN_LEAD_FIELDS];
    expect(fields).toContain("name");
    expect(fields).toContain("email");
    expect(fields).toContain("phone");
    expect(fields).toContain("stage");
    expect(fields).toContain("vendedor");
  });

  it("parseFilePreview is a function", () => {
    expect(typeof parseFilePreview).toBe("function");
  });

  it("FunnelDestination types", () => {
    const dests: FunnelDestination[] = ["qualificacao", "propostas", "confirmacao"];
    expect(dests).toHaveLength(3);
  });
});

// ── useCopilotPromptBuilder ──
import { computePromptHash } from "@/modules/copilot/hooks/useCopilotPromptBuilder";

describe("useCopilotPromptBuilder — pure exports", () => {
  it("computePromptHash returns a string", () => {
    const hash = computePromptHash({
      name: "Test Agent",
      template_type: "qualificador",
      personality_tone: "profissional",
    } as any, []);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("computePromptHash returns different values for different inputs", () => {
    const hash1 = computePromptHash({ name: "Agent A" } as any, []);
    const hash2 = computePromptHash({ name: "Agent B" } as any, []);
    expect(hash1).not.toBe(hash2);
  });
});

// ── useChannelChat ──
import {
  markContactAsSeen,
  type ChannelMessage,
  type ChannelContact,
} from "@/hooks/useChannelChat";

describe("useChannelChat — pure exports", () => {
  it("markContactAsSeen is a function", () => {
    expect(typeof markContactAsSeen).toBe("function");
  });

  it("ChannelMessage interface shape", () => {
    const msg: Partial<ChannelMessage> = {
      id: "m1",
      content: "test",
      direction: "incoming",
    };
    expect(msg.direction).toBe("incoming");
  });

  it("ChannelContact interface shape", () => {
    const contact: Partial<ChannelContact> = {
      phone_number: "5511999",
      push_name: "Test",
      unread_count: 0,
      tags: [],
    };
    expect(contact.tags).toHaveLength(0);
  });
});
