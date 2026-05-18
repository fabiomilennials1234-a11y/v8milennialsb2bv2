/**
 * TDD tests for follow-up cadence schema + gate removal
 * Issue #228: Follow-up rules should sync for ALL agent types, not just "followup" template_type
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Supabase chain mock — tracks calls per table
// ---------------------------------------------------------------------------
const callLog: Array<{ table: string; method: string; args: any[] }> = [];

function createChainMock(
  tableName: string,
  singleData: any = { id: "mock-1", template_type: "custom" },
  listData: any[] = [],
) {
  const chain: Record<string, any> = {};
  const methods = [
    "select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike",
    "contains", "order", "limit", "range", "insert", "update", "delete",
    "upsert", "not", "is", "filter", "match", "overlaps", "textSearch", "csv",
  ];
  methods.forEach((m) => {
    chain[m] = vi.fn((...args: any[]) => {
      callLog.push({ table: tableName, method: m, args });
      return chain;
    });
  });
  chain.single = vi.fn(() => {
    callLog.push({ table: tableName, method: "single", args: [] });
    return Promise.resolve({ data: singleData, error: null });
  });
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: singleData, error: null })
  );
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: listData, error: null, count: listData.length }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

// Table-specific chain factories for the update flow
const tableChains: Record<string, ReturnType<typeof createChainMock>> = {};

function getOrCreateChain(table: string) {
  if (!tableChains[table]) {
    // Default: agent update returns a "custom" template_type agent
    if (table === "copilot_agents") {
      tableChains[table] = createChainMock(table, {
        id: "a1",
        name: "Custom Agent",
        template_type: "custom",
        organization_id: "org-t",
      });
    } else {
      tableChains[table] = createChainMock(table);
    }
  }
  return tableChains[table];
}

const mockFrom = vi.fn((table: string) => getOrCreateChain(table));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: { data: {} }, error: null }) },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://example.com/file.png" } }),
      }),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "token" } }),
}));
vi.mock("@/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t", profile_id: "p1" } }),
  isVirtualTeamMember: () => false,
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/hooks/useCopilotPromptBuilder", () => ({
  generatePrompt: vi.fn().mockReturnValue({ systemPrompt: "mock prompt", metadata: { version: "1.0" } }),
  saveCopilotSystemPrompt: vi.fn().mockResolvedValue(undefined),
  regenerateAndSavePrompt: vi.fn().mockResolvedValue(undefined),
  computePromptHash: vi.fn().mockReturnValue("hash123"),
}));
vi.mock("@/lib/copilot/custom-instructions-utils", () => ({
  parseCustomInstructions: (v: any) => ({ dos: v || "", donts: "" }),
  serializeCustomInstructions: (d: string, dt: string) => JSON.stringify({ dos: d, donts: dt }),
}));

const mockFollowupRuleToDB = vi.fn((r: any, agentId: string) => ({
  ...r,
  agent_id: agentId,
}));
vi.mock("@/hooks/useAgentFollowupRules", () => ({
  followupRuleToDB: (...args: any[]) => mockFollowupRuleToDB(...args),
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
  assertIsAdmin: vi.fn().mockResolvedValue(undefined),
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

import { useUpdateCopilotAgentFromWizard } from "@/hooks/useCopilotAgents";

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------
function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ---------------------------------------------------------------------------
// Minimal wizard data
// ---------------------------------------------------------------------------
function makeWizardData(overrides: Record<string, any> = {}) {
  return {
    name: "Test Agent",
    personality: { tone: "profissional", style: "consultivo", energy: "moderada" },
    skills: [],
    allowedTopics: [],
    forbiddenTopics: [],
    mainObjective: "Test",
    objectiveComposite: { mission: "Test", success_criteria: "", limits: "" },
    businessContext: {},
    conversationStyle: {},
    qualificationRules: {},
    availability: {},
    fewShotExamples: [],
    customInstructions: null,
    activationTriggers: null,
    outboundConfig: null,
    automationActions: null,
    canMoveCards: false,
    activePipes: [],
    activeStages: {},
    autoMoveOnQualify: false,
    autoMoveOnObjective: false,
    moveRules: [],
    faqs: [],
    kanbanRules: [],
    followupRules: [
      {
        name: "Rule 1",
        triggerType: "no_response",
        triggerDelayHours: 24,
        triggerDelayMinutes: 0,
        maxFollowups: 3,
        isActive: true,
        followupStyle: "value",
      },
    ],
    canQualifyLead: true,
    canScheduleMeeting: true,
    canSendFollowup: true,
    canUpdateCrm: false,
    canAnswerFaq: true,
    canCreateLead: true,
    canTransferHuman: true,
    maxConversationTurns: 20,
    responseDelayMs: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Follow-up rules gate removal — useUpdateCopilotAgentFromWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callLog.length = 0;
    // Reset table chains so each test gets fresh mocks
    Object.keys(tableChains).forEach((k) => delete tableChains[k]);
  });

  it("syncs follow-up rules for template_type='custom' (non-followup agent)", async () => {
    // Agent update returns template_type = "custom"
    tableChains["copilot_agents"] = createChainMock("copilot_agents", {
      id: "a1",
      name: "Custom Agent",
      template_type: "custom",
      organization_id: "org-t",
    });

    const { result } = renderHook(() => useUpdateCopilotAgentFromWizard(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      agentId: "a1",
      data: makeWizardData() as any,
      documentsToRemove: [],
    });

    // Follow-up rules table should have been touched (delete + insert)
    const followupCalls = callLog.filter(
      (c) => c.table === "copilot_agent_followup_rules"
    );
    expect(followupCalls.length).toBeGreaterThan(0);

    // Specifically: delete was called to clear old rules
    const deleteCalls = followupCalls.filter((c) => c.method === "delete");
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);

    // And insert was called for the new rules
    const insertCalls = followupCalls.filter((c) => c.method === "insert");
    expect(insertCalls.length).toBe(1);

    // followupRuleToDB was called
    expect(mockFollowupRuleToDB).toHaveBeenCalled();
  });

  it("syncs follow-up rules for template_type='followup' (regression)", async () => {
    // Agent update returns template_type = "followup"
    tableChains["copilot_agents"] = createChainMock("copilot_agents", {
      id: "a1",
      name: "Follow-up Agent",
      template_type: "followup",
      organization_id: "org-t",
    });

    const { result } = renderHook(() => useUpdateCopilotAgentFromWizard(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      agentId: "a1",
      data: makeWizardData() as any,
      documentsToRemove: [],
    });

    // Follow-up rules table touched
    const followupCalls = callLog.filter(
      (c) => c.table === "copilot_agent_followup_rules"
    );
    expect(followupCalls.length).toBeGreaterThan(0);

    const deleteCalls = followupCalls.filter((c) => c.method === "delete");
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);

    const insertCalls = followupCalls.filter((c) => c.method === "insert");
    expect(insertCalls.length).toBe(1);
  });

  it("skips insert when followupRules array is empty (all agent types)", async () => {
    tableChains["copilot_agents"] = createChainMock("copilot_agents", {
      id: "a1",
      name: "SDR Agent",
      template_type: "sdr",
      organization_id: "org-t",
    });

    const { result } = renderHook(() => useUpdateCopilotAgentFromWizard(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      agentId: "a1",
      data: makeWizardData({ followupRules: [] }) as any,
      documentsToRemove: [],
    });

    const followupCalls = callLog.filter(
      (c) => c.table === "copilot_agent_followup_rules"
    );

    // Delete should still run to clear old rules
    const deleteCalls = followupCalls.filter((c) => c.method === "delete");
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);

    // But insert should NOT run (empty array)
    const insertCalls = followupCalls.filter((c) => c.method === "insert");
    expect(insertCalls.length).toBe(0);
  });
});
