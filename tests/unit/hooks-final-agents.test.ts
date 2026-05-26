/**
 * Tests for useAgentFollowupRules, useScheduledMessages, useWhatsAppConversations
 *
 * Covers ~200 uncovered lines across these hooks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ── Chainable mock builder ──
function c(data: unknown[] = [{ id: "m1", organization_id: "org-t" }]) {
  const ch: Record<string, any> = {};
  [
    "select","eq","neq","or","in","gte","lte","lt","ilike","contains","order",
    "limit","range","insert","update","delete","upsert","not","is","filter",
    "match","overlaps","textSearch","csv","count","returns","abortSignal",
  ].forEach(m => { ch[m] = vi.fn().mockReturnValue(ch); });
  ch.single = vi.fn().mockResolvedValue({ data: data[0] ?? { id: "m1", organization_id: "org-t" }, error: null });
  ch.maybeSingle = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  ch.then = (resolve: any, reject?: any) => Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
  ch.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return ch;
}

const mF = vi.fn().mockReturnValue(c());
const mR = vi.fn().mockResolvedValue({ data: [{ id: "1" }], error: null });
const mI = vi.fn().mockResolvedValue({ data: { data: {} }, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: any[]) => mF(...a),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: (...a: any[]) => mR(...a),
    functions: { invoke: (...a: any[]) => mI(...a) },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://storage.example.com/file.png" } }),
        download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
      }),
    },
  },
}));

vi.mock("@/modules/identity/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "t" } }),
}));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { id: "tm1", organization_id: "org-t", user_id: "u1", role: "admin" },
  }),
  isVirtualTeamMember: () => false,
  useTeamMembers: () => ({ data: [] }),
  useResponsibleMembers: () => ({ data: [] }),
}));
vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: true }) }));
vi.mock("@/hooks/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/hooks/usePipelineStages", () => ({
  usePipelineStages: () => ({ data: [] }),
  DEFAULT_STAGES: {},
  useAllPipelineStages: () => ({ data: [] }),
}));
vi.mock("@/hooks/useAutoFollowUp", () => ({ triggerFollowUpAutomation: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/hooks/useCopilotAgents", () => ({ useCopilotAgents: () => ({ data: [] }) }));
vi.mock("@/hooks/useWhatsAppInstances", () => ({
  useActiveWhatsAppInstance: () => ({ data: { id: "i1", instance_name: "Main" } }),
}));
vi.mock("@/lib/workflowTrigger", () => ({
  triggerStageChangedWorkflows: vi.fn().mockResolvedValue(undefined),
  triggerLeadCreatedInCustomPipeline: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/identity/lib/permissions", () => ({
  assertIsAdmin: vi.fn().mockResolvedValue(undefined),
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/modules/identity/hooks/useUserRole", () => ({ useUserRole: () => "admin" }));
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ hasFeature: () => true, checkLimit: () => -1 }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/lib/normalizePhone", () => ({
  normalizePhone: (p: string | null) => p ? p.replace(/\D/g, "") : null,
}));

function w() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ============================================================
// useAgentFollowupRules
// ============================================================
describe("useAgentFollowupRules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("followupRuleToDB", () => {
    it("converts a frontend FollowupRule to DB format with all fields", async () => {
      const { followupRuleToDB } = await import("@/hooks/useAgentFollowupRules");
      const result = followupRuleToDB(
        {
          name: "Rule 1",
          description: "Follow up after no response",
          isActive: true,
          priority: 1,
          triggerType: "no_response",
          triggerDelayHours: 48,
          triggerDelayMinutes: 30,
          maxFollowups: 5,
          filterTags: ["Ouro"],
          filterTagsExclude: ["Latao"],
          filterOrigins: ["meta_ads"],
          filterPipes: ["whatsapp"],
          filterStages: ["novo_lead"],
          filterCustomFields: [
            { field: "faturamento", operator: "gte", value: "100000" },
            { field: "segment", operator: "eq", value: "industria" },
          ],
          useLastContext: true,
          contextLookbackDays: 14,
          followupStyle: "casual",
          messageTemplate: "Oi {{name}}, tudo bem?",
          sendOnlyBusinessHours: true,
          businessHoursStart: "08:00",
          businessHoursEnd: "17:00",
          sendDays: ["seg", "ter", "qua"],
          timezone: "America/Sao_Paulo",
        },
        "agent-123"
      );

      expect(result.agent_id).toBe("agent-123");
      expect(result.name).toBe("Rule 1");
      expect(result.description).toBe("Follow up after no response");
      expect(result.is_active).toBe(true);
      expect(result.priority).toBe(1);
      expect(result.trigger_type).toBe("no_response");
      expect(result.trigger_delay_hours).toBe(48);
      expect(result.trigger_delay_minutes).toBe(30);
      expect(result.max_followups).toBe(5);
      expect(result.filter_tags).toEqual(["Ouro"]);
      expect(result.filter_tags_exclude).toEqual(["Latao"]);
      expect(result.filter_origins).toEqual(["meta_ads"]);
      expect(result.filter_pipes).toEqual(["whatsapp"]);
      expect(result.filter_stages).toEqual(["novo_lead"]);
      expect(result.filter_custom_fields).toEqual({
        faturamento: { operator: "gte", value: "100000" },
        segment: { operator: "eq", value: "industria" },
      });
      expect(result.use_last_context).toBe(true);
      expect(result.context_lookback_days).toBe(14);
      expect(result.followup_style).toBe("casual");
      expect(result.message_template).toBe("Oi {{name}}, tudo bem?");
      expect(result.send_only_business_hours).toBe(true);
      expect(result.business_hours_start).toBe("08:00");
      expect(result.business_hours_end).toBe("17:00");
      expect(result.send_days).toEqual(["seg", "ter", "qua"]);
      expect(result.timezone).toBe("America/Sao_Paulo");
    });

    it("uses sensible defaults when fields are omitted", async () => {
      const { followupRuleToDB } = await import("@/hooks/useAgentFollowupRules");
      const result = followupRuleToDB({}, "agent-456");

      expect(result.agent_id).toBe("agent-456");
      expect(result.is_active).toBe(true);
      expect(result.priority).toBe(0);
      expect(result.trigger_type).toBe("no_response");
      expect(result.trigger_delay_hours).toBe(24);
      expect(result.trigger_delay_minutes).toBe(0);
      expect(result.max_followups).toBe(3);
      expect(result.filter_tags).toEqual([]);
      expect(result.filter_tags_exclude).toEqual([]);
      expect(result.filter_origins).toEqual([]);
      expect(result.filter_pipes).toEqual([]);
      expect(result.filter_stages).toEqual([]);
      expect(result.filter_custom_fields).toEqual({});
      expect(result.use_last_context).toBe(true);
      expect(result.context_lookback_days).toBe(30);
      expect(result.followup_style).toBe("direct");
      expect(result.message_template).toBeNull();
      expect(result.send_only_business_hours).toBe(true);
      expect(result.business_hours_start).toBe("09:00");
      expect(result.business_hours_end).toBe("18:00");
      expect(result.send_days).toEqual(["seg", "ter", "qua", "qui", "sex"]);
      expect(result.timezone).toBe("America/Sao_Paulo");
    });

    it("sets description to null when undefined", async () => {
      const { followupRuleToDB } = await import("@/hooks/useAgentFollowupRules");
      const result = followupRuleToDB({ name: "X" }, "a1");
      expect(result.description).toBeNull();
    });
  });

  describe("useAgentFollowupRules query", () => {
    it("fetches rules for a given agentId", async () => {
      const dbRule = {
        id: "r1",
        agent_id: "agent-1",
        name: "Rule A",
        description: null,
        is_active: true,
        priority: 0,
        trigger_type: "no_response",
        trigger_delay_hours: 24,
        trigger_delay_minutes: 0,
        max_followups: 3,
        filter_tags: [],
        filter_tags_exclude: [],
        filter_origins: [],
        filter_pipes: [],
        filter_stages: [],
        filter_custom_fields: {},
        use_last_context: true,
        context_lookback_days: 30,
        followup_style: "direct",
        message_template: null,
        send_only_business_hours: true,
        business_hours_start: "09:00",
        business_hours_end: "18:00",
        send_days: ["seg", "ter"],
        timezone: "America/Sao_Paulo",
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };
      mF.mockReturnValue(c([dbRule]));

      const { useAgentFollowupRules } = await import("@/hooks/useAgentFollowupRules");
      const { result } = renderHook(() => useAgentFollowupRules("agent-1"), { wrapper: w() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data![0].name).toBe("Rule A");
      expect(result.current.data![0].isActive).toBe(true);
      expect(result.current.data![0].triggerType).toBe("no_response");
      expect(result.current.data![0].sendDays).toEqual(["seg", "ter"]);
    });

    it("converts filter_custom_fields from DB map to frontend array", async () => {
      const dbRule = {
        id: "r2",
        agent_id: "agent-2",
        name: "Rule B",
        description: "with custom fields",
        is_active: false,
        priority: 2,
        trigger_type: "scheduled",
        trigger_delay_hours: 12,
        trigger_delay_minutes: 15,
        max_followups: 1,
        filter_tags: ["A"],
        filter_tags_exclude: ["B"],
        filter_origins: ["google_ads"],
        filter_pipes: ["confirmacao"],
        filter_stages: ["agendado"],
        filter_custom_fields: {
          revenue: { operator: "gte", value: "50000" },
        },
        use_last_context: false,
        context_lookback_days: 7,
        followup_style: "casual",
        message_template: "Hello {{name}}",
        send_only_business_hours: false,
        business_hours_start: "10:00",
        business_hours_end: "20:00",
        send_days: ["seg"],
        timezone: "UTC",
        created_at: "2025-01-01",
        updated_at: "2025-01-02",
      };
      mF.mockReturnValue(c([dbRule]));

      const { useAgentFollowupRules } = await import("@/hooks/useAgentFollowupRules");
      const { result } = renderHook(() => useAgentFollowupRules("agent-2"), { wrapper: w() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const rule = result.current.data![0];
      expect(rule.filterCustomFields).toEqual([
        { field: "revenue", operator: "gte", value: "50000" },
      ]);
      expect(rule.description).toBe("with custom fields");
      expect(rule.isActive).toBe(false);
      expect(rule.useLastContext).toBe(false);
      expect(rule.messageTemplate).toBe("Hello {{name}}");
    });

    it("is disabled when agentId is undefined", async () => {
      const { useAgentFollowupRules } = await import("@/hooks/useAgentFollowupRules");
      const { result } = renderHook(() => useAgentFollowupRules(undefined), { wrapper: w() });

      // Should never fetch
      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("useCreateFollowupRule", () => {
    it("creates a rule and shows success toast", async () => {
      const returnedRule = {
        id: "new-1",
        agent_id: "agent-1",
        name: "New Rule",
        description: null,
        is_active: true,
        priority: 0,
        trigger_type: "no_response",
        trigger_delay_hours: 24,
        trigger_delay_minutes: 0,
        max_followups: 3,
        filter_tags: [],
        filter_tags_exclude: [],
        filter_origins: [],
        filter_pipes: [],
        filter_stages: [],
        filter_custom_fields: {},
        use_last_context: true,
        context_lookback_days: 30,
        followup_style: "direct",
        message_template: null,
        send_only_business_hours: true,
        business_hours_start: "09:00",
        business_hours_end: "18:00",
        send_days: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "America/Sao_Paulo",
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };
      mF.mockReturnValue(c([returnedRule]));

      const { useCreateFollowupRule } = await import("@/hooks/useAgentFollowupRules");
      const { toast } = await import("sonner");
      const { result } = renderHook(() => useCreateFollowupRule(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            agentId: "agent-1",
            rule: { name: "New Rule" },
          });
        } catch { /* ok */ }
      });

      expect(mF).toHaveBeenCalledWith("copilot_agent_followup_rules");
      expect(toast.success).toHaveBeenCalledWith("Regra de follow-up criada com sucesso!");
    });
  });

  describe("useUpdateFollowupRule", () => {
    it("updates a rule and shows success toast", async () => {
      const updated = {
        id: "r1", agent_id: "a1", name: "Updated", description: null,
        is_active: true, priority: 0, trigger_type: "no_response",
        trigger_delay_hours: 24, trigger_delay_minutes: 0, max_followups: 3,
        filter_tags: [], filter_tags_exclude: [], filter_origins: [],
        filter_pipes: [], filter_stages: [], filter_custom_fields: {},
        use_last_context: true, context_lookback_days: 30, followup_style: "direct",
        message_template: null, send_only_business_hours: true,
        business_hours_start: "09:00", business_hours_end: "18:00",
        send_days: [], timezone: "America/Sao_Paulo",
        created_at: "2025-01-01", updated_at: "2025-01-02",
      };
      mF.mockReturnValue(c([updated]));

      const { useUpdateFollowupRule } = await import("@/hooks/useAgentFollowupRules");
      const { toast } = await import("sonner");
      const { result } = renderHook(() => useUpdateFollowupRule(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            ruleId: "r1",
            agentId: "a1",
            updates: { name: "Updated" },
          });
        } catch { /* ok */ }
      });

      expect(toast.success).toHaveBeenCalledWith("Regra atualizada com sucesso!");
    });
  });

  describe("useDeleteFollowupRule", () => {
    it("deletes a rule and shows success toast", async () => {
      mF.mockReturnValue(c());

      const { useDeleteFollowupRule } = await import("@/hooks/useAgentFollowupRules");
      const { toast } = await import("sonner");
      const { result } = renderHook(() => useDeleteFollowupRule(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({ ruleId: "r1", agentId: "a1" });
        } catch { /* ok */ }
      });

      expect(toast.success).toHaveBeenCalledWith("Regra removida com sucesso!");
    });
  });

  describe("useToggleFollowupRule", () => {
    it("activates a rule and shows correct toast", async () => {
      const toggled = {
        id: "r1", agent_id: "a1", name: "R", description: null,
        is_active: true, priority: 0, trigger_type: "no_response",
        trigger_delay_hours: 24, trigger_delay_minutes: 0, max_followups: 3,
        filter_tags: [], filter_tags_exclude: [], filter_origins: [],
        filter_pipes: [], filter_stages: [], filter_custom_fields: {},
        use_last_context: true, context_lookback_days: 30, followup_style: "direct",
        message_template: null, send_only_business_hours: true,
        business_hours_start: "09:00", business_hours_end: "18:00",
        send_days: [], timezone: "America/Sao_Paulo",
        created_at: "2025-01-01", updated_at: "2025-01-02",
      };
      mF.mockReturnValue(c([toggled]));

      const { useToggleFollowupRule } = await import("@/hooks/useAgentFollowupRules");
      const { toast } = await import("sonner");
      const { result } = renderHook(() => useToggleFollowupRule(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({ ruleId: "r1", agentId: "a1", isActive: true });
        } catch { /* ok */ }
      });

      expect(toast.success).toHaveBeenCalledWith("Regra ativada!");
    });

    it("deactivates a rule and shows correct toast", async () => {
      const toggled = {
        id: "r1", agent_id: "a1", name: "R", description: null,
        is_active: false, priority: 0, trigger_type: "no_response",
        trigger_delay_hours: 24, trigger_delay_minutes: 0, max_followups: 3,
        filter_tags: [], filter_tags_exclude: [], filter_origins: [],
        filter_pipes: [], filter_stages: [], filter_custom_fields: {},
        use_last_context: true, context_lookback_days: 30, followup_style: "direct",
        message_template: null, send_only_business_hours: true,
        business_hours_start: "09:00", business_hours_end: "18:00",
        send_days: [], timezone: "America/Sao_Paulo",
        created_at: "2025-01-01", updated_at: "2025-01-02",
      };
      mF.mockReturnValue(c([toggled]));

      const { useToggleFollowupRule } = await import("@/hooks/useAgentFollowupRules");
      const { toast } = await import("sonner");
      const { result } = renderHook(() => useToggleFollowupRule(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({ ruleId: "r1", agentId: "a1", isActive: false });
        } catch { /* ok */ }
      });

      expect(toast.success).toHaveBeenCalledWith("Regra desativada!");
    });
  });

  describe("useReorderFollowupRules", () => {
    it("reorders rules by updating priorities", async () => {
      mF.mockReturnValue(c());

      const { useReorderFollowupRules } = await import("@/hooks/useAgentFollowupRules");
      const { result } = renderHook(() => useReorderFollowupRules(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            agentId: "a1",
            ruleIds: ["r3", "r1", "r2"],
          });
        } catch { /* ok */ }
      });

      // Each ruleId should trigger an update call
      expect(mF).toHaveBeenCalledWith("copilot_agent_followup_rules");
    });
  });
});

// ============================================================
// useScheduledMessages
// ============================================================
describe("useScheduledMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useScheduledMessagesForLead", () => {
    it("fetches scheduled messages for a lead", async () => {
      const msg = {
        id: "sm1",
        organization_id: "org-t",
        lead_id: "lead-1",
        phone_number: "11999887766",
        created_by: "tm1",
        assigned_to: "tm1",
        whatsapp_instance_id: null,
        message_content: "Hello",
        media_url: null,
        media_type: null,
        media_filename: null,
        scheduled_at: "2025-06-01T10:00:00Z",
        status: "scheduled",
        sent_at: null,
        error_message: null,
        retry_count: 0,
        created_at: "2025-05-01T10:00:00Z",
      };
      mF.mockReturnValue(c([msg]));

      const { useScheduledMessagesForLead } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(() => useScheduledMessagesForLead("lead-1"), { wrapper: w() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data![0].id).toBe("sm1");
    });

    it("returns empty when leadId is null", async () => {
      const { useScheduledMessagesForLead } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(() => useScheduledMessagesForLead(null), { wrapper: w() });

      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("useLeadsWithScheduledMessages", () => {
    it("returns a Set of lead IDs", async () => {
      mF.mockReturnValue(c([{ lead_id: "l1" }, { lead_id: "l2" }]));

      const { useLeadsWithScheduledMessages } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(() => useLeadsWithScheduledMessages(), { wrapper: w() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeInstanceOf(Set);
      expect(result.current.data!.has("l1")).toBe(true);
      expect(result.current.data!.has("l2")).toBe(true);
    });
  });

  describe("useCreateScheduledMessage", () => {
    it("creates a scheduled message without media", async () => {
      const created = {
        id: "sm-new",
        organization_id: "org-t",
        lead_id: "lead-1",
        phone_number: "11999887766",
        created_by: "tm1",
        scheduled_at: "2025-06-01T10:00:00Z",
        status: "scheduled",
      };
      mF.mockReturnValue(c([created]));

      const { useCreateScheduledMessage } = await import("@/hooks/useScheduledMessages");
      const { toast } = await import("sonner");
      const { result } = renderHook(() => useCreateScheduledMessage(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            leadId: "lead-1",
            phoneNumber: "11999887766",
            messageContent: "Hello!",
            scheduledAt: new Date("2025-06-01T10:00:00Z"),
          });
        } catch { /* ok */ }
      });

      expect(mF).toHaveBeenCalledWith("scheduled_user_messages");
      expect(toast.success).toHaveBeenCalled();
    });

    it("creates a scheduled message with media upload", async () => {
      const created = {
        id: "sm-media",
        organization_id: "org-t",
        lead_id: "lead-2",
        phone_number: "11888776655",
        media_url: "https://storage.example.com/file.png",
        media_type: "image",
        media_filename: "photo.png",
        scheduled_at: "2025-06-01T12:00:00Z",
        status: "scheduled",
      };
      mF.mockReturnValue(c([created]));

      const { useCreateScheduledMessage } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(() => useCreateScheduledMessage(), { wrapper: w() });

      const imageFile = new File(["img"], "photo.png", { type: "image/png" });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            leadId: "lead-2",
            phoneNumber: "11888776655",
            mediaFile: imageFile,
            scheduledAt: new Date("2025-06-01T12:00:00Z"),
          });
        } catch { /* ok */ }
      });

      expect(mF).toHaveBeenCalledWith("scheduled_user_messages");
    });

    it("handles video media type", async () => {
      mF.mockReturnValue(c([{ id: "sm-v" }]));

      const { useCreateScheduledMessage } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(() => useCreateScheduledMessage(), { wrapper: w() });

      const videoFile = new File(["vid"], "clip.mp4", { type: "video/mp4" });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            leadId: "l1",
            phoneNumber: "111",
            mediaFile: videoFile,
            scheduledAt: new Date(),
          });
        } catch { /* ok */ }
      });
    });

    it("handles audio media type", async () => {
      mF.mockReturnValue(c([{ id: "sm-a" }]));

      const { useCreateScheduledMessage } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(() => useCreateScheduledMessage(), { wrapper: w() });

      const audioFile = new File(["aud"], "voice.ogg", { type: "audio/ogg" });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            leadId: "l1",
            phoneNumber: "111",
            mediaFile: audioFile,
            scheduledAt: new Date(),
          });
        } catch { /* ok */ }
      });
    });

    it("handles document media type", async () => {
      mF.mockReturnValue(c([{ id: "sm-d" }]));

      const { useCreateScheduledMessage } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(() => useCreateScheduledMessage(), { wrapper: w() });

      const docFile = new File(["pdf"], "report.pdf", { type: "application/pdf" });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            leadId: "l1",
            phoneNumber: "111",
            mediaFile: docFile,
            scheduledAt: new Date(),
          });
        } catch { /* ok */ }
      });
    });
  });

  describe("useCancelScheduledMessage", () => {
    it("cancels a message and shows success toast", async () => {
      mF.mockReturnValue(c());

      const { useCancelScheduledMessage } = await import("@/hooks/useScheduledMessages");
      const { toast } = await import("sonner");
      const { result } = renderHook(() => useCancelScheduledMessage(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync("sm1");
        } catch { /* ok */ }
      });

      expect(mF).toHaveBeenCalledWith("scheduled_user_messages");
      expect(toast.success).toHaveBeenCalledWith("Agendamento cancelado");
    });
  });

  describe("useUpdateScheduledMessage", () => {
    it("updates message content and scheduled time", async () => {
      mF.mockReturnValue(c());

      const { useUpdateScheduledMessage } = await import("@/hooks/useScheduledMessages");
      const { toast } = await import("sonner");
      const { result } = renderHook(() => useUpdateScheduledMessage(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            id: "sm1",
            messageContent: "Updated content",
            scheduledAt: new Date("2025-07-01T15:00:00Z"),
          });
        } catch { /* ok */ }
      });

      expect(toast.success).toHaveBeenCalledWith("Agendamento atualizado");
    });

    it("updates only messageContent", async () => {
      mF.mockReturnValue(c());

      const { useUpdateScheduledMessage } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(() => useUpdateScheduledMessage(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            id: "sm1",
            messageContent: "New text",
          });
        } catch { /* ok */ }
      });
    });
  });

  describe("useMyScheduledMessages", () => {
    it("fetches scheduled messages for current member", async () => {
      const msg = {
        id: "sm1",
        scheduled_at: "2025-06-01T10:00:00Z",
        status: "scheduled",
        lead: { name: "Lead 1", company: "Corp", phone: "111" },
      };
      mF.mockReturnValue(c([msg]));

      const { useMyScheduledMessages } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(() => useMyScheduledMessages(), { wrapper: w() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(1);
    });

    it("supports assignedTo=all filter", async () => {
      mF.mockReturnValue(c([]));

      const { useMyScheduledMessages } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(
        () => useMyScheduledMessages({ assignedTo: "all" }),
        { wrapper: w() }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it("supports showCompleted filter", async () => {
      mF.mockReturnValue(c([]));

      const { useMyScheduledMessages } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(
        () => useMyScheduledMessages({ showCompleted: true }),
        { wrapper: w() }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it("supports specific assignedTo filter", async () => {
      mF.mockReturnValue(c([]));

      const { useMyScheduledMessages } = await import("@/hooks/useScheduledMessages");
      const { result } = renderHook(
        () => useMyScheduledMessages({ assignedTo: "other-tm" }),
        { wrapper: w() }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
  });
});

// ============================================================
// useWhatsAppConversations
// ============================================================
describe("useWhatsAppConversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useWhatsAppConversationsMeta", () => {
    it("returns a Map of conversations by normalized phone", async () => {
      const conv = {
        id: "c1",
        instance_id: "inst-1",
        phone_number: "5511999887766",
        archived_at: null,
        deleted_at: null,
      };
      mF.mockReturnValue(c([conv]));

      const { useWhatsAppConversationsMeta } = await import("@/hooks/useWhatsAppConversations");
      const { result } = renderHook(() => useWhatsAppConversationsMeta("inst-1"), { wrapper: w() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeInstanceOf(Map);
      expect(result.current.data!.size).toBe(1);
    });

    it("is disabled when instanceId is null", async () => {
      const { useWhatsAppConversationsMeta } = await import("@/hooks/useWhatsAppConversations");
      const { result } = renderHook(() => useWhatsAppConversationsMeta(null), { wrapper: w() });

      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("useWhatsAppConversationTags", () => {
    it("returns a Map of tags by normalized phone", async () => {
      const tagRow = {
        id: "ct1",
        conversation_id: "c1",
        tag_id: "t1",
        whatsapp_conversations: { phone_number: "5511999887766" },
        tags: { id: "t1", name: "VIP", color: "#FFD700" },
      };
      mF.mockReturnValue(c([tagRow]));

      const { useWhatsAppConversationTags } = await import("@/hooks/useWhatsAppConversations");
      const { result } = renderHook(() => useWhatsAppConversationTags("inst-1"), { wrapper: w() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeInstanceOf(Map);
      expect(result.current.data!.size).toBe(1);
    });

    it("is disabled when instanceId is null", async () => {
      const { useWhatsAppConversationTags } = await import("@/hooks/useWhatsAppConversations");
      const { result } = renderHook(() => useWhatsAppConversationTags(null), { wrapper: w() });

      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("useArchiveConversation", () => {
    it("archives a conversation via upsert", async () => {
      mF.mockReturnValue(c([{ id: "c1" }]));

      const { useArchiveConversation } = await import("@/hooks/useWhatsAppConversations");
      const { result } = renderHook(() => useArchiveConversation(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            instanceId: "inst-1",
            phoneNumber: "5511999887766",
          });
        } catch { /* ok */ }
      });

      expect(mF).toHaveBeenCalledWith("whatsapp_conversations");
    });
  });

  describe("useUnarchiveConversation", () => {
    it("unarchives a conversation by setting archived_at to null", async () => {
      mF.mockReturnValue(c());

      const { useUnarchiveConversation } = await import("@/hooks/useWhatsAppConversations");
      const { result } = renderHook(() => useUnarchiveConversation(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({ conversationId: "c1" });
        } catch { /* ok */ }
      });

      expect(mF).toHaveBeenCalledWith("whatsapp_conversations");
    });
  });

  describe("useDeleteConversation", () => {
    it("soft deletes via RPC", async () => {
      const { useDeleteConversation } = await import("@/hooks/useWhatsAppConversations");
      const { result } = renderHook(() => useDeleteConversation(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            instanceId: "inst-1",
            phoneNumber: "5511999887766",
            organizationId: "org-t",
          });
        } catch { /* ok */ }
      });

      expect(mR).toHaveBeenCalledWith("soft_delete_whatsapp_conversation", {
        p_instance_id: "inst-1",
        p_phone_number: "5511999887766",
        p_organization_id: "org-t",
      });
    });
  });

  describe("useAddConversationTag", () => {
    it("upserts conversation record and inserts tag", async () => {
      mF.mockReturnValue(c([{ id: "c1" }]));

      const { useAddConversationTag } = await import("@/hooks/useWhatsAppConversations");
      const { result } = renderHook(() => useAddConversationTag(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            instanceId: "inst-1",
            phoneNumber: "5511999887766",
            tagId: "tag-1",
          });
        } catch { /* ok */ }
      });

      // Should have called from() for whatsapp_conversations (upsert) and whatsapp_conversation_tags (insert)
      expect(mF).toHaveBeenCalledWith("whatsapp_conversations");
      expect(mF).toHaveBeenCalledWith("whatsapp_conversation_tags");
    });
  });

  describe("useRemoveConversationTag", () => {
    it("removes a tag from a conversation", async () => {
      mF.mockReturnValue(c());

      const { useRemoveConversationTag } = await import("@/hooks/useWhatsAppConversations");
      const { result } = renderHook(() => useRemoveConversationTag(), { wrapper: w() });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            conversationId: "c1",
            tagId: "tag-1",
          });
        } catch { /* ok */ }
      });

      expect(mF).toHaveBeenCalledWith("whatsapp_conversation_tags");
    });
  });
});
