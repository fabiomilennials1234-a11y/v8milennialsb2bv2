/**
 * test-workflow-system — Automated test suite for TorqueCRM Workflow Visual
 *
 * Tests all 16 triggers, 21 condition operators, 30 action types, and E2E flow.
 * Only runs in non-production environments or with TEST_MODE_SECRET header.
 *
 * POST /functions/v1/test-workflow-system
 * Body: { suite?: 'triggers' | 'conditions' | 'actions' | 'e2e' | 'all', org_id?: string }
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { compare } from "../_shared/workflow-condition-evaluator.ts";
import { fireTrigger } from "../_shared/workflow-trigger.ts";
import { executeWorkflowAction } from "../_shared/workflow-action-handler.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  duration_ms: number;
}

interface TestReport {
  summary: { total: number; passed: number; failed: number; skipped: number };
  triggers: TestResult[];
  conditions: TestResult[];
  actions: TestResult[];
  e2e: TestResult[];
  duration_ms: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const TEST_PREFIX = "__wftest__";

function testId(): string {
  return crypto.randomUUID();
}

async function runTest(
  name: string,
  fn: () => Promise<void>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, status: "passed", duration_ms: Date.now() - start };
  } catch (err) {
    return {
      name,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - start,
    };
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ─── Test Data Factory ──────────────────────────────────────────────────────

async function createTestOrg(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from("organizations")
    .insert({ name: `${TEST_PREFIX}org_${Date.now()}`, slug: `${TEST_PREFIX}${Date.now()}` })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create test org: ${error.message}`);
  return data.id;
}

async function createTestLead(
  supabase: SupabaseClient,
  orgId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await supabase
    .from("leads")
    .insert({
      organization_id: orgId,
      name: `${TEST_PREFIX}Lead_${Date.now()}`,
      phone: "5511999990000",
      email: `${TEST_PREFIX}${Date.now()}@test.com`,
      origin: "test",
      qualification_score: 50,
      rating: 5,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create test lead: ${error.message}`);
  return data.id;
}

async function createTestWorkflow(
  supabase: SupabaseClient,
  orgId: string,
  triggerType: string,
  triggerConfig: Record<string, unknown> = {},
  definition?: Record<string, unknown>,
): Promise<string> {
  const defaultDef = {
    nodes: [
      { id: "trigger-1", type: "trigger", data: { label: "Test Trigger", triggerType, config: triggerConfig }, position: { x: 0, y: 0 } },
      { id: "end-1", type: "end", data: { label: "End" }, position: { x: 0, y: 200 } },
    ],
    edges: [
      { id: "e-trigger-end", source: "trigger-1", target: "end-1" },
    ],
  };

  const { data, error } = await supabase
    .from("workflows")
    .insert({
      organization_id: orgId,
      name: `${TEST_PREFIX}wf_${triggerType}_${Date.now()}`,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      definition: definition || defaultDef,
      is_active: true,
      loop_limit: 100,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create test workflow: ${error.message}`);
  return data.id;
}

async function createTestTag(supabase: SupabaseClient, orgId: string, name?: string): Promise<string> {
  const tagName = name || `${TEST_PREFIX}tag_${Date.now()}`;
  const { data, error } = await supabase
    .from("tags")
    .insert({ name: tagName, color: "#6366f1", organization_id: orgId })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create test tag: ${error.message}`);
  return data.id;
}

async function createTestTeamMember(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ id: string; userId: string }> {
  // Create a test auth user first — use a deterministic test user or skip if exists
  const testEmail = `${TEST_PREFIX}member_${Date.now()}@test.com`;
  const { data: authUser } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: "testpassword123!",
    email_confirm: true,
  });
  const userId = authUser?.user?.id || testId();

  const { data, error } = await supabase
    .from("team_members")
    .insert({
      organization_id: orgId,
      user_id: userId,
      name: `${TEST_PREFIX}Member`,
      role: "admin",
      is_active: true,
      metric_type: "meetings",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create test team member: ${error.message}`);
  return { id: data.id, userId };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

async function cleanupTestData(supabase: SupabaseClient, orgId: string): Promise<void> {
  // Clean in reverse dependency order
  const tables = [
    "workflow_execution_steps",
    "workflow_executions",
    "workflows",
    "lead_tags",
    "tags",
    "follow_ups",
    "notifications",
    "lead_history",
    "pending_ai_actions",
    "scheduled_pipe_messages",
    "pipeline_entries",
    "campanha_leads",
    "leads",
    "team_members",
  ];

  for (const table of tables) {
    try {
      await supabase.from(table).delete().eq("organization_id", orgId);
    } catch {
      // Some tables may not have organization_id — try lead-level cleanup
    }
  }

  // Clean org-level resources
  try {
    await supabase.from("organizations").delete().eq("id", orgId);
  } catch {
    // Ignore cleanup errors
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONDITION TESTS — Pure function tests via compare()
// ═══════════════════════════════════════════════════════════════════════════

function buildConditionTests(): Array<{ name: string; fn: () => Promise<void> }> {
  const cases: Array<{
    name: string;
    fieldValue: unknown;
    op: string;
    conditionValue: string;
    expected: boolean;
  }> = [
    // ── equals ──
    { name: "equals: string match", fieldValue: "João", op: "equals", conditionValue: "João", expected: true },
    { name: "equals: string no match", fieldValue: "Maria", op: "equals", conditionValue: "João", expected: false },
    { name: "equals: case insensitive", fieldValue: "JOAO", op: "equals", conditionValue: "joao", expected: true },
    { name: "equals: null field", fieldValue: null, op: "equals", conditionValue: "test", expected: false },
    { name: "equals: empty strings", fieldValue: "", op: "equals", conditionValue: "", expected: true },

    // ── not_equals ──
    { name: "not_equals: different", fieldValue: "A", op: "not_equals", conditionValue: "B", expected: true },
    { name: "not_equals: same", fieldValue: "A", op: "not_equals", conditionValue: "A", expected: false },

    // ── contains ──
    { name: "contains: substring found", fieldValue: "Hello World", op: "contains", conditionValue: "World", expected: true },
    { name: "contains: not found", fieldValue: "Hello", op: "contains", conditionValue: "World", expected: false },
    { name: "contains: case insensitive", fieldValue: "Hello World", op: "contains", conditionValue: "hello", expected: true },
    { name: "contains: null field", fieldValue: null, op: "contains", conditionValue: "test", expected: false },

    // ── not_contains ──
    { name: "not_contains: absent", fieldValue: "Hello", op: "not_contains", conditionValue: "World", expected: true },
    { name: "not_contains: present", fieldValue: "Hello World", op: "not_contains", conditionValue: "World", expected: false },

    // ── greater_than ──
    { name: "greater_than: 100 > 50", fieldValue: 100, op: "greater_than", conditionValue: "50", expected: true },
    { name: "greater_than: 50 > 100", fieldValue: 50, op: "greater_than", conditionValue: "100", expected: false },
    { name: "greater_than: equal values", fieldValue: 50, op: "greater_than", conditionValue: "50", expected: false },
    { name: "greater_than: null field", fieldValue: null, op: "greater_than", conditionValue: "50", expected: false },
    { name: "greater_than: string number", fieldValue: "75", op: "greater_than", conditionValue: "50", expected: true },

    // ── less_than ──
    { name: "less_than: 30 < 50", fieldValue: 30, op: "less_than", conditionValue: "50", expected: true },
    { name: "less_than: 100 < 50", fieldValue: 100, op: "less_than", conditionValue: "50", expected: false },
    { name: "less_than: null field", fieldValue: null, op: "less_than", conditionValue: "50", expected: false },

    // ── greater_or_equal ──
    { name: "greater_or_equal: 50 >= 50", fieldValue: 50, op: "greater_or_equal", conditionValue: "50", expected: true },
    { name: "greater_or_equal: 49 >= 50", fieldValue: 49, op: "greater_or_equal", conditionValue: "50", expected: false },
    { name: "greater_or_equal: 51 >= 50", fieldValue: 51, op: "greater_or_equal", conditionValue: "50", expected: true },

    // ── less_or_equal ──
    { name: "less_or_equal: 50 <= 50", fieldValue: 50, op: "less_or_equal", conditionValue: "50", expected: true },
    { name: "less_or_equal: 51 <= 50", fieldValue: 51, op: "less_or_equal", conditionValue: "50", expected: false },

    // ── is_empty ──
    { name: "is_empty: null", fieldValue: null, op: "is_empty", conditionValue: "", expected: true },
    { name: "is_empty: empty string", fieldValue: "", op: "is_empty", conditionValue: "", expected: true },
    { name: "is_empty: whitespace only", fieldValue: "   ", op: "is_empty", conditionValue: "", expected: true },
    { name: "is_empty: non-empty", fieldValue: "text", op: "is_empty", conditionValue: "", expected: false },
    { name: "is_empty: undefined", fieldValue: undefined, op: "is_empty", conditionValue: "", expected: true },

    // ── is_not_empty ──
    { name: "is_not_empty: has value", fieldValue: "text", op: "is_not_empty", conditionValue: "", expected: true },
    { name: "is_not_empty: null", fieldValue: null, op: "is_not_empty", conditionValue: "", expected: false },
    { name: "is_not_empty: empty string", fieldValue: "", op: "is_not_empty", conditionValue: "", expected: false },

    // ── starts_with ──
    { name: "starts_with: match", fieldValue: "Hello World", op: "starts_with", conditionValue: "Hello", expected: true },
    { name: "starts_with: no match", fieldValue: "World Hello", op: "starts_with", conditionValue: "Hello", expected: false },
    { name: "starts_with: case insensitive", fieldValue: "hello", op: "starts_with", conditionValue: "HEL", expected: true },

    // ── ends_with ──
    { name: "ends_with: match", fieldValue: "Hello World", op: "ends_with", conditionValue: "World", expected: true },
    { name: "ends_with: no match", fieldValue: "Hello World", op: "ends_with", conditionValue: "Hello", expected: false },

    // ── has_tag ──
    { name: "has_tag: present", fieldValue: "vip,hot,new", op: "has_tag", conditionValue: "hot", expected: true },
    { name: "has_tag: absent", fieldValue: "vip,hot,new", op: "has_tag", conditionValue: "cold", expected: false },
    { name: "has_tag: empty tags", fieldValue: "", op: "has_tag", conditionValue: "vip", expected: false },

    // ── not_has_tag ──
    { name: "not_has_tag: absent", fieldValue: "vip,hot", op: "not_has_tag", conditionValue: "cold", expected: true },
    { name: "not_has_tag: present", fieldValue: "vip,hot", op: "not_has_tag", conditionValue: "hot", expected: false },

    // ── in_stage ──
    { name: "in_stage: match", fieldValue: "novo", op: "in_stage", conditionValue: "novo", expected: true },
    { name: "in_stage: no match", fieldValue: "qualificado", op: "in_stage", conditionValue: "novo", expected: false },

    // ── not_in_stage ──
    { name: "not_in_stage: different", fieldValue: "qualificado", op: "not_in_stage", conditionValue: "novo", expected: true },
    { name: "not_in_stage: same", fieldValue: "novo", op: "not_in_stage", conditionValue: "novo", expected: false },

    // ── in_list ──
    { name: "in_list: present", fieldValue: "SP", op: "in_list", conditionValue: "SP,RJ,MG", expected: true },
    { name: "in_list: absent", fieldValue: "BA", op: "in_list", conditionValue: "SP,RJ,MG", expected: false },
    { name: "in_list: case insensitive", fieldValue: "sp", op: "in_list", conditionValue: "SP,RJ", expected: true },

    // ── not_in_list ──
    { name: "not_in_list: absent", fieldValue: "BA", op: "not_in_list", conditionValue: "SP,RJ,MG", expected: true },
    { name: "not_in_list: present", fieldValue: "SP", op: "not_in_list", conditionValue: "SP,RJ,MG", expected: false },

    // ── is_true ──
    { name: "is_true: boolean true", fieldValue: true, op: "is_true", conditionValue: "", expected: true },
    { name: "is_true: string true", fieldValue: "true", op: "is_true", conditionValue: "", expected: true },
    { name: "is_true: string 1", fieldValue: "1", op: "is_true", conditionValue: "", expected: true },
    { name: "is_true: boolean false", fieldValue: false, op: "is_true", conditionValue: "", expected: false },

    // ── is_false ──
    { name: "is_false: boolean false", fieldValue: false, op: "is_false", conditionValue: "", expected: true },
    { name: "is_false: string false", fieldValue: "false", op: "is_false", conditionValue: "", expected: true },
    { name: "is_false: null", fieldValue: null, op: "is_false", conditionValue: "", expected: true },
    { name: "is_false: boolean true", fieldValue: true, op: "is_false", conditionValue: "", expected: false },

    // ── regex_match ──
    { name: "regex_match: email pattern", fieldValue: "test@example.com", op: "regex_match", conditionValue: "^[\\w.+-]+@[\\w-]+\\.[\\w.]+$", expected: true },
    { name: "regex_match: no match", fieldValue: "not-an-email", op: "regex_match", conditionValue: "^[\\w.+-]+@[\\w-]+\\.[\\w.]+$", expected: false },
    { name: "regex_match: phone BR", fieldValue: "5511999990000", op: "regex_match", conditionValue: "^55\\d{10,11}$", expected: true },
    { name: "regex_match: invalid regex", fieldValue: "test", op: "regex_match", conditionValue: "[invalid(", expected: false },
  ];

  return cases.map((c) => ({
    name: c.name,
    fn: async () => {
      const result = compare(c.fieldValue, c.op, c.conditionValue);
      assert(
        result === c.expected,
        `Expected ${c.expected} but got ${result} for compare(${JSON.stringify(c.fieldValue)}, "${c.op}", "${c.conditionValue}")`,
      );
    },
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIGGER TESTS — via fireTrigger against test workflows
// ═══════════════════════════════════════════════════════════════════════════

function buildTriggerTests(
  supabase: SupabaseClient,
  orgId: string,
): Array<{ name: string; fn: () => Promise<void> }> {
  return [
    {
      name: "stage_changed — fires on matching stage",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "stage_changed", {
          pipe_type: "whatsapp",
          stages: ["qualificado"],
        });
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "stage_changed", leadId,
          context: { pipe_type: "whatsapp", to_stage: "qualificado" },
        });
        assert(count > 0, `Expected at least 1 execution, got ${count}`);
        const { data: execs } = await supabase.from("workflow_executions")
          .select("id, status").eq("workflow_id", wfId).eq("lead_id", leadId);
        assert(execs != null && execs.length > 0, "No execution created");
      },
    },
    {
      name: "stage_changed — does not fire on non-matching stage",
      fn: async () => {
        await createTestWorkflow(supabase, orgId, "stage_changed", {
          pipe_type: "whatsapp",
          stages: ["vendido"],
        });
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "stage_changed", leadId,
          context: { pipe_type: "whatsapp", to_stage: "novo" },
        });
        assert(count === 0, `Expected 0 executions for non-matching stage, got ${count}`);
      },
    },
    {
      name: "lead_created — fires without filter",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "lead_created", {});
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "lead_created", leadId,
          context: { origin: "website" },
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "lead_created — respects origin filter",
      fn: async () => {
        await createTestWorkflow(supabase, orgId, "lead_created", { filter_origin: "landing_page" });
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "lead_created", leadId,
          context: { origin: "website" },
        });
        assert(count === 0, `Expected 0 for non-matching origin, got ${count}`);
      },
    },
    {
      name: "tag_added — fires on matching tag",
      fn: async () => {
        const tagId = await createTestTag(supabase, orgId, `${TEST_PREFIX}vip`);
        const wfId = await createTestWorkflow(supabase, orgId, "tag_added", { tag_id: tagId });
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "tag_added", leadId,
          context: { tag_id: tagId },
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "score_reached — fires when score meets threshold",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "score_reached", { min_score: 80 });
        const leadId = await createTestLead(supabase, orgId, { qualification_score: 90 });
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "score_reached", leadId,
          context: { score: 90 },
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "score_reached — does not fire below threshold",
      fn: async () => {
        await createTestWorkflow(supabase, orgId, "score_reached", { min_score: 80 });
        const leadId = await createTestLead(supabase, orgId, { qualification_score: 50 });
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "score_reached", leadId,
          context: { score: 50 },
        });
        assert(count === 0, `Expected 0 below threshold, got ${count}`);
      },
    },
    {
      name: "lead_assigned — fires on any role",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "lead_assigned", { role: "any" });
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "lead_assigned", leadId,
          context: { role: "sdr" },
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "field_changed — fires on matching field",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "field_changed", { field_name: "company" });
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "field_changed", leadId,
          context: { field_name: "company", new_value: "Acme Corp" },
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "field_changed — does not fire on non-matching field",
      fn: async () => {
        await createTestWorkflow(supabase, orgId, "field_changed", { field_name: "email" });
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "field_changed", leadId,
          context: { field_name: "company", new_value: "Acme" },
        });
        assert(count === 0, `Expected 0 for non-matching field, got ${count}`);
      },
    },
    {
      name: "meeting_confirmed — fires",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "meeting_confirmed", {});
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "meeting_confirmed", leadId,
          context: {},
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "proposal_accepted — fires",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "proposal_accepted", {});
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "proposal_accepted", leadId,
          context: {},
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "proposal_lost — fires",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "proposal_lost", {});
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "proposal_lost", leadId,
          context: {},
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "campaign_status_changed — fires",
      fn: async () => {
        const campaignId = testId();
        const wfId = await createTestWorkflow(supabase, orgId, "campaign_status_changed", { campaign_id: campaignId });
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "campaign_status_changed", leadId,
          context: { campanha_id: campaignId },
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "lead_replied — fires via fireTrigger",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "lead_replied", { channel: "any" });
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "lead_replied", leadId,
          context: { channel: "whatsapp", message: "Oi, tenho interesse" },
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "webhook_received — fires on matching key",
      fn: async () => {
        const webhookKey = `${TEST_PREFIX}key_${Date.now()}`;
        const wfId = await createTestWorkflow(supabase, orgId, "webhook_received", { webhook_key: webhookKey });
        const leadId = await createTestLead(supabase, orgId);
        const count = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "webhook_received", leadId,
          context: { webhook_key: webhookKey },
        });
        assert(count > 0, `Expected >= 1, got ${count}`);
      },
    },
    {
      name: "cron — workflow exists and is active (config test)",
      fn: async () => {
        // Cron triggers are time-based; we just verify the workflow is created correctly
        const wfId = await createTestWorkflow(supabase, orgId, "cron", { cron_expression: "*/5 * * * *" });
        const { data: wf } = await supabase.from("workflows").select("trigger_type, trigger_config, is_active").eq("id", wfId).single();
        assert(wf != null, "Workflow not found");
        assert(wf.trigger_type === "cron", `Expected trigger_type=cron, got ${wf.trigger_type}`);
        assert(wf.is_active === true, "Workflow should be active");
        assert((wf.trigger_config as Record<string, unknown>).cron_expression === "*/5 * * * *", "Cron expression mismatch");
      },
    },
    {
      name: "lead_no_reply — workflow config validates",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "lead_no_reply", { timeout_hours: 24 });
        const { data: wf } = await supabase.from("workflows").select("trigger_config").eq("id", wfId).single();
        assert(wf != null, "Workflow not found");
        assert((wf.trigger_config as Record<string, unknown>).timeout_hours === 24, "timeout_hours mismatch");
      },
    },
    {
      name: "meeting_not_confirmed — workflow config validates",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "meeting_not_confirmed", { hours_before: 12 });
        const { data: wf } = await supabase.from("workflows").select("trigger_config").eq("id", wfId).single();
        assert(wf != null, "Workflow not found");
        assert((wf.trigger_config as Record<string, unknown>).hours_before === 12, "hours_before mismatch");
      },
    },
    {
      name: "followup_overdue — workflow config validates",
      fn: async () => {
        const wfId = await createTestWorkflow(supabase, orgId, "followup_overdue", {});
        const { data: wf } = await supabase.from("workflows").select("trigger_type, is_active").eq("id", wfId).single();
        assert(wf != null, "Workflow not found");
        assert(wf.trigger_type === "followup_overdue", "trigger_type mismatch");
        assert(wf.is_active === true, "Workflow should be active");
      },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION TESTS — via executeWorkflowAction with real DB
// ═══════════════════════════════════════════════════════════════════════════

function buildActionTests(
  supabase: SupabaseClient,
  orgId: string,
): Array<{ name: string; fn: () => Promise<void> }> {
  return [
    // ── Lead Management (DB-verifiable) ──
    {
      name: "move_stage — updates pipe_whatsapp",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId, { pipe_whatsapp: "novo" });
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "move_stage", pipeType: "whatsapp", targetStage: "qualificado" },
          executionContext: {},
        });
        assert(result.success, `move_stage failed: ${result.error}`);
        const { data: lead } = await supabase.from("leads").select("pipe_whatsapp").eq("id", leadId).single();
        assert(lead?.pipe_whatsapp === "qualificado", `Expected qualificado, got ${lead?.pipe_whatsapp}`);
      },
    },
    {
      name: "move_stage — confirmacao pipe",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "move_stage", pipeType: "confirmacao", targetStage: "confirmado" },
          executionContext: {},
        });
        assert(result.success, `move_stage confirmacao failed: ${result.error}`);
        const { data: confPipeline } = await supabase.from("pipelines").select("id").eq("organization_id", orgId).eq("slug", "confirmacao").eq("type", "system").maybeSingle();
        assert(confPipeline?.id, "confirmacao pipeline not found");
        const { data: confEntry } = await supabase.from("pipeline_entries").select("stage_key").eq("pipeline_id", confPipeline!.id).eq("lead_id", leadId).maybeSingle();
        assert(confEntry?.stage_key === "confirmado", `Expected confirmado in pipeline_entries, got ${confEntry?.stage_key}`);
      },
    },
    {
      name: "move_stage — propostas pipe",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "move_stage", pipeType: "propostas", targetStage: "negociacao" },
          executionContext: {},
        });
        assert(result.success, `move_stage propostas failed: ${result.error}`);
        const { data: propPipeline } = await supabase.from("pipelines").select("id").eq("organization_id", orgId).eq("slug", "propostas").eq("type", "system").maybeSingle();
        assert(propPipeline?.id, "propostas pipeline not found");
        const { data: propEntry } = await supabase.from("pipeline_entries").select("stage_key").eq("pipeline_id", propPipeline!.id).eq("lead_id", leadId).maybeSingle();
        assert(propEntry?.stage_key === "negociacao", `Expected negociacao in pipeline_entries, got ${propEntry?.stage_key}`);
      },
    },
    {
      name: "add_tag — creates tag and associates to lead",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const tagName = `${TEST_PREFIX}tag_action_${Date.now()}`;
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "add_tag", tagName },
          executionContext: {},
        });
        assert(result.success, `add_tag failed: ${result.error}`);
        const { data: tags } = await supabase.from("lead_tags")
          .select("tag:tags(name)").eq("lead_id", leadId);
        const tagNames = tags?.map((t: { tag: { name: string } | null }) => t.tag?.name) || [];
        assert(tagNames.includes(tagName), `Tag ${tagName} not found on lead`);
      },
    },
    {
      name: "remove_tag — removes tag from lead",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const tagId = await createTestTag(supabase, orgId, `${TEST_PREFIX}removable_${Date.now()}`);
        await supabase.from("lead_tags").insert({ lead_id: leadId, tag_id: tagId });
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "remove_tag", tagId },
          executionContext: {},
        });
        assert(result.success, `remove_tag failed: ${result.error}`);
        const { data: remaining } = await supabase.from("lead_tags")
          .select("id").eq("lead_id", leadId).eq("tag_id", tagId);
        assert(!remaining?.length, "Tag should have been removed");
      },
    },
    {
      name: "update_lead_field — updates lead name",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "update_lead_field", fieldName: "name", fieldValue: `${TEST_PREFIX}Updated` },
          executionContext: {},
        });
        assert(result.success, `update_lead_field failed: ${result.error}`);
        const { data: lead } = await supabase.from("leads").select("name").eq("id", leadId).single();
        assert(lead?.name === `${TEST_PREFIX}Updated`, `Expected Updated, got ${lead?.name}`);
      },
    },
    {
      name: "update_lead_field — updates company",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "update_lead_field", fieldName: "company", fieldValue: "Acme Corp" },
          executionContext: {},
        });
        assert(result.success, `update_lead_field company failed: ${result.error}`);
        const { data: lead } = await supabase.from("leads").select("company").eq("id", leadId).single();
        assert(lead?.company === "Acme Corp", `Expected Acme Corp, got ${lead?.company}`);
      },
    },
    {
      name: "update_rating — sets rating value",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "update_rating", ratingValue: 8 },
          executionContext: {},
        });
        assert(result.success, `update_rating failed: ${result.error}`);
        const { data: lead } = await supabase.from("leads").select("rating").eq("id", leadId).single();
        assert(lead?.rating === 8, `Expected 8, got ${lead?.rating}`);
      },
    },
    {
      name: "update_rating — clamps to 0-10",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "update_rating", ratingValue: 15 },
          executionContext: {},
        });
        assert(result.success, `update_rating failed: ${result.error}`);
        const { data: lead } = await supabase.from("leads").select("rating").eq("id", leadId).single();
        assert(lead?.rating === 10, `Expected clamped to 10, got ${lead?.rating}`);
      },
    },
    {
      name: "calculate_score — enqueues pending_ai_actions",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "calculate_score" },
          executionContext: {},
        });
        assert(result.success, `calculate_score failed: ${result.error}`);
        const { data: actions } = await supabase.from("pending_ai_actions")
          .select("action_type").eq("lead_id", leadId).eq("action_type", "update_qualification_score");
        assert(actions != null && actions.length > 0, "No pending_ai_actions created for calculate_score");
      },
    },
    {
      name: "duplicate_to_pipe — creates confirmacao entry",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "duplicate_to_pipe", targetPipeType: "confirmacao", targetPipeStage: "agendado" },
          executionContext: {},
        });
        assert(result.success, `duplicate_to_pipe failed: ${result.error}`);
        const { data: dupConfPipeline } = await supabase.from("pipelines").select("id").eq("organization_id", orgId).eq("slug", "confirmacao").eq("type", "system").maybeSingle();
        assert(dupConfPipeline?.id, "confirmacao pipeline not found");
        const { data: dupConfEntry } = await supabase.from("pipeline_entries").select("stage_key").eq("pipeline_id", dupConfPipeline!.id).eq("lead_id", leadId).maybeSingle();
        assert(dupConfEntry?.stage_key === "agendado", `Expected agendado in pipeline_entries, got ${dupConfEntry?.stage_key}`);
      },
    },
    {
      name: "duplicate_to_pipe — creates propostas entry",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "duplicate_to_pipe", targetPipeType: "propostas", targetPipeStage: "enviada" },
          executionContext: {},
        });
        assert(result.success, `duplicate_to_pipe propostas failed: ${result.error}`);
        const { data: dupPropPipeline } = await supabase.from("pipelines").select("id").eq("organization_id", orgId).eq("slug", "propostas").eq("type", "system").maybeSingle();
        assert(dupPropPipeline?.id, "propostas pipeline not found");
        const { data: dupPropEntry } = await supabase.from("pipeline_entries").select("stage_key").eq("pipeline_id", dupPropPipeline!.id).eq("lead_id", leadId).maybeSingle();
        assert(dupPropEntry?.stage_key === "enviada", `Expected enviada in pipeline_entries, got ${dupPropEntry?.stage_key}`);
      },
    },
    {
      name: "remove_from_pipe — removes whatsapp entry",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId, { pipe_whatsapp: "novo" });
        // Create entry in pipeline_entries
        const { data: waPipeline } = await supabase.from("pipelines").select("id").eq("organization_id", orgId).eq("slug", "whatsapp").eq("type", "system").maybeSingle();
        if (waPipeline?.id) {
          await supabase.from("pipeline_entries").insert({ pipeline_id: waPipeline.id, lead_id: leadId, organization_id: orgId, stage_key: "novo" });
        }
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "remove_from_pipe", pipeType: "whatsapp" },
          executionContext: {},
        });
        assert(result.success, `remove_from_pipe failed: ${result.error}`);
        // Verify removal from pipeline_entries
        if (waPipeline?.id) {
          const { data: entry } = await supabase.from("pipeline_entries").select("id").eq("pipeline_id", waPipeline.id).eq("lead_id", leadId).maybeSingle();
          assert(!entry, "pipeline_entries record should have been deleted");
        }
      },
    },
    {
      name: "mark_as_lost — updates propostas to perdido",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        // Create entry in pipeline_entries for propostas
        const { data: lostPropPipeline } = await supabase.from("pipelines").select("id").eq("organization_id", orgId).eq("slug", "propostas").eq("type", "system").maybeSingle();
        assert(lostPropPipeline?.id, "propostas pipeline not found");
        await supabase.from("pipeline_entries").insert({ pipeline_id: lostPropPipeline!.id, lead_id: leadId, organization_id: orgId, stage_key: "enviada" });
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "mark_as_lost", pipeType: "propostas", lostReason: "Preço alto" },
          executionContext: {},
        });
        assert(result.success, `mark_as_lost failed: ${result.error}`);
        const { data: lostEntry } = await supabase.from("pipeline_entries").select("stage_key, metadata").eq("pipeline_id", lostPropPipeline!.id).eq("lead_id", leadId).maybeSingle();
        assert(lostEntry?.stage_key === "perdido", `Expected perdido in pipeline_entries, got ${lostEntry?.stage_key}`);
      },
    },
    {
      name: "create_followup — inserts follow_up record",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "create_followup", followupTitle: `${TEST_PREFIX}Follow Up`, followupPriority: "high" },
          executionContext: {},
        });
        assert(result.success, `create_followup failed: ${result.error}`);
        const { data: fup } = await supabase.from("follow_ups")
          .select("title, priority").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        assert(fup?.title?.includes(TEST_PREFIX), "Follow-up not created");
        assert(fup?.priority === "high", `Expected high priority, got ${fup?.priority}`);
      },
    },
    {
      name: "notify_team_member — inserts notification",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        let memberId: string;
        let memberUserId: string;
        try {
          const m = await createTestTeamMember(supabase, orgId);
          memberId = m.id;
          memberUserId = m.userId;
        } catch {
          // If auth admin fails, create member with a placeholder user_id
          const placeholderUserId = testId();
          const { data: tm } = await supabase.from("team_members").insert({
            organization_id: orgId, user_id: placeholderUserId, name: `${TEST_PREFIX}Notify`,
            role: "admin", is_active: true,
          }).select("id").single();
          memberId = tm!.id;
          memberUserId = placeholderUserId;
        }
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "notify_team_member", notifyMemberId: memberId, notifyMessage: `${TEST_PREFIX}Test notification` },
          executionContext: {},
        });
        assert(result.success, `notify_team_member failed: ${result.error}`);
        const { data: notif } = await supabase.from("notifications")
          .select("type, description").eq("user_id", memberUserId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        assert(notif?.type === "workflow_notification", "Notification not created");
      },
    },
    {
      name: "assign_sdr — sets sdr_id on lead",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        let memberId: string;
        try {
          const m = await createTestTeamMember(supabase, orgId);
          memberId = m.id;
        } catch {
          const { data: tm } = await supabase.from("team_members").insert({
            organization_id: orgId, user_id: testId(), name: `${TEST_PREFIX}SDR`,
            role: "admin", is_active: true, metric_type: "meetings",
          }).select("id").single();
          memberId = tm!.id;
        }
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "assign_sdr", assigneeId: memberId, assignMode: "specific" },
          executionContext: {},
        });
        assert(result.success, `assign_sdr failed: ${result.error}`);
        const { data: lead } = await supabase.from("leads").select("sdr_id, responsible_id").eq("id", leadId).single();
        assert(lead?.sdr_id === memberId, `Expected sdr_id=${memberId}, got ${lead?.sdr_id}`);
      },
    },
    {
      name: "assign_closer — sets closer_id on lead",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        let memberId: string;
        try {
          const m = await createTestTeamMember(supabase, orgId);
          memberId = m.id;
        } catch {
          const { data: tm } = await supabase.from("team_members").insert({
            organization_id: orgId, user_id: testId(), name: `${TEST_PREFIX}Closer`,
            role: "admin", is_active: true, metric_type: "sales",
          }).select("id").single();
          memberId = tm!.id;
        }
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "assign_closer", assigneeId: memberId, assignMode: "specific" },
          executionContext: {},
        });
        assert(result.success, `assign_closer failed: ${result.error}`);
        const { data: lead } = await supabase.from("leads").select("closer_id").eq("id", leadId).single();
        assert(lead?.closer_id === memberId, `Expected closer_id=${memberId}, got ${lead?.closer_id}`);
      },
    },
    {
      name: "generate_ai_message — enqueues pending_ai_actions",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "generate_ai_message", aiPrompt: "Test prompt" },
          executionContext: {},
        });
        assert(result.success, `generate_ai_message failed: ${result.error}`);
        const { data: actions } = await supabase.from("pending_ai_actions")
          .select("action_type, payload").eq("lead_id", leadId).eq("action_type", "generate_message");
        assert(actions != null && actions.length > 0, "No pending_ai_actions for generate_message");
      },
    },
    {
      name: "schedule_meeting — enqueues pending_ai_actions",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "schedule_meeting" },
          executionContext: {},
        });
        assert(result.success, `schedule_meeting failed: ${result.error}`);
        const { data: actions } = await supabase.from("pending_ai_actions")
          .select("action_type").eq("lead_id", leadId).eq("action_type", "schedule_meeting");
        assert(actions != null && actions.length > 0, "No pending_ai_actions for schedule_meeting");
      },
    },
    {
      name: "send_semi_automatic — creates scheduled_pipe_messages",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "send_semi_automatic", semiAutoMessage: `${TEST_PREFIX}Semi auto msg` },
          executionContext: {},
        });
        assert(result.success, `send_semi_automatic failed: ${result.error}`);
        const { data: msgs } = await supabase.from("scheduled_pipe_messages")
          .select("status, message_content").eq("lead_id", leadId).eq("source", "workflow");
        assert(msgs != null && msgs.length > 0, "No scheduled_pipe_messages created");
        assert(msgs[0].status === "waiting_approval", `Expected waiting_approval, got ${msgs[0].status}`);
      },
    },

    // ── Communication actions (validate they return proper errors without WA instance) ──
    {
      name: "send_whatsapp — returns error without WA instance",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "send_whatsapp", messageTemplate: "Olá {{nome}}" },
          executionContext: {},
        });
        // Expected to fail gracefully without WhatsApp instance configured
        assert(!result.success, "send_whatsapp should fail without WA instance");
        assert(result.error != null && result.error.length > 0, "Should have error message");
      },
    },
    {
      name: "send_whatsapp_audio — returns error without WA instance",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "send_whatsapp_audio", audioUrl: "https://example.com/audio.mp3" },
          executionContext: {},
        });
        assert(!result.success, "send_whatsapp_audio should fail without WA instance");
      },
    },
    {
      name: "send_whatsapp_image — returns error without WA instance",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "send_whatsapp_image", imageUrl: "https://example.com/img.png" },
          executionContext: {},
        });
        assert(!result.success, "send_whatsapp_image should fail without WA instance");
      },
    },
    {
      name: "send_whatsapp_template — returns error without WA instance",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "send_whatsapp_template", templateId: testId() },
          executionContext: {},
        });
        assert(!result.success, "send_whatsapp_template should fail without WA instance");
      },
    },

    // ── Campaign actions (validate error handling) ──
    {
      name: "add_to_campaign — returns error without campaign",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "add_to_campaign" },
          executionContext: {},
        });
        assert(!result.success, "add_to_campaign should fail without campaignId");
        assert(result.error?.includes("No campaign"), `Unexpected error: ${result.error}`);
      },
    },
    {
      name: "remove_from_campaign — returns error without campaign",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "remove_from_campaign" },
          executionContext: {},
        });
        assert(!result.success, "remove_from_campaign should fail without campaignId");
      },
    },
    {
      name: "move_campaign_stage — returns error without campaign",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "move_campaign_stage" },
          executionContext: {},
        });
        assert(!result.success, "move_campaign_stage should fail without campaignId");
      },
    },

    // ── External service actions (validate they handle missing config) ──
    {
      name: "send_meta_message — lead sem Instagram vinculado não age (#1691)",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "send_meta_message", metaMessage: "Test" },
          executionContext: {},
        });
        // O lead de teste nasce sem vínculo em `lead_social_identities`, e é
        // esse o desfecho esperado: o nó NÃO age, e isso não é erro. Nada de
        // rede sai daqui — a rota da Meta direta deixou de ser o destino.
        assert(result.success === true, "Deveria pular, não falhar");
        assert(
          (result.data as { skipped?: boolean } | undefined)?.skipped === true,
          "Deveria marcar o passo como pulado",
        );
      },
    },
    {
      name: "create_calendar_event — calls edge function (may fail in test env)",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "create_calendar_event", eventTitle: `${TEST_PREFIX}Event` },
          executionContext: {},
        });
        assert(typeof result.success === "boolean", "Should return ActionResult");
      },
    },
    {
      name: "create_tinyerp_order — calls edge function (may fail in test env)",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "create_tinyerp_order" },
          executionContext: {},
        });
        assert(typeof result.success === "boolean", "Should return ActionResult");
      },
    },
    {
      name: "create_tinyerp_upsell_order — calls edge function (may fail in test env)",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "create_tinyerp_upsell_order" },
          executionContext: {},
        });
        assert(typeof result.success === "boolean", "Should return ActionResult");
      },
    },
    {
      name: "summarize_conversation — calls edge function (may fail in test env)",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "summarize_conversation" },
          executionContext: {},
        });
        assert(typeof result.success === "boolean", "Should return ActionResult");
      },
    },
    {
      name: "evaluate_conversation — calls edge function (may fail in test env)",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "evaluate_conversation" },
          executionContext: {},
        });
        assert(typeof result.success === "boolean", "Should return ActionResult");
      },
    },

    // ── Validation: unknown action type ──
    {
      name: "unknown action type — returns error",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "nonexistent_action" },
          executionContext: {},
        });
        assert(!result.success, "Should fail for unknown action");
        assert(result.error?.includes("Unknown action type"), `Unexpected error: ${result.error}`);
      },
    },

    // ── Validation: missing required fields ──
    {
      name: "move_stage — fails without targetStage",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "move_stage", pipeType: "whatsapp" },
          executionContext: {},
        });
        assert(!result.success, "move_stage should fail without targetStage");
      },
    },
    {
      name: "update_lead_field — fails without fieldName",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "update_lead_field" },
          executionContext: {},
        });
        assert(!result.success, "update_lead_field should fail without fieldName");
      },
    },
    {
      name: "update_custom_field — fails without customFieldName",
      fn: async () => {
        const leadId = await createTestLead(supabase, orgId);
        const result = await executeWorkflowAction({
          supabase, organizationId: orgId, leadId,
          nodeData: { actionType: "update_custom_field" },
          executionContext: {},
        });
        assert(!result.success, "update_custom_field should fail without field name");
      },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// E2E TEST — Full workflow: trigger → condition → action
// ═══════════════════════════════════════════════════════════════════════════

function buildE2eTests(
  supabase: SupabaseClient,
  orgId: string,
): Array<{ name: string; fn: () => Promise<void> }> {
  return [
    {
      name: "E2E: lead_created → condition(score > 0) → add_tag",
      fn: async () => {
        const tagName = `${TEST_PREFIX}e2e_tag_${Date.now()}`;

        // 1. Create workflow with full definition
        const definition = {
          nodes: [
            { id: "t1", type: "trigger", data: { label: "Lead Criado", triggerType: "lead_created", config: {} }, position: { x: 0, y: 0 } },
            { id: "c1", type: "condition", data: { label: "Score > 0", field: "score", operator: "greater_than", value: "0" }, position: { x: 0, y: 100 } },
            { id: "a1", type: "action", data: { label: "Add Tag", actionType: "add_tag", tagName }, position: { x: 0, y: 200 } },
            { id: "e1", type: "end", data: { label: "Fim" }, position: { x: 0, y: 300 } },
          ],
          edges: [
            { id: "e-t1-c1", source: "t1", target: "c1" },
            { id: "e-c1-a1", source: "c1", target: "a1", sourceHandle: "source-true" },
            { id: "e-a1-e1", source: "a1", target: "e1" },
          ],
        };

        const wfId = await createTestWorkflow(supabase, orgId, "lead_created", {}, definition);
        const leadId = await createTestLead(supabase, orgId, { qualification_score: 50 });

        // 2. Fire trigger
        const triggerCount = await fireTrigger({
          supabase, organizationId: orgId, triggerType: "lead_created", leadId,
          context: {},
        });
        assert(triggerCount > 0, `Expected at least 1 trigger, got ${triggerCount}`);

        // 3. Wait for execution to be created
        await new Promise((r) => setTimeout(r, 500));

        const { data: execs } = await supabase.from("workflow_executions")
          .select("id, status, lead_id")
          .eq("workflow_id", wfId)
          .eq("lead_id", leadId)
          .order("started_at", { ascending: false })
          .limit(1);

        assert(execs != null && execs.length > 0, "No workflow execution found");
        const execution = execs[0];
        assert(execution.status === "running", `Expected running status, got ${execution.status}`);

        // 4. Manually process the execution (simulate what the worker does)
        const { executeWorkflow } = await import("../_shared/workflow-executor.ts");

        const { data: wf } = await supabase.from("workflows")
          .select("definition, loop_limit")
          .eq("id", wfId)
          .single();

        const execResult = await executeWorkflow({
          supabase,
          executionId: execution.id,
          workflowId: wfId,
          organizationId: orgId,
          leadId,
          definition: wf!.definition,
          loopLimit: wf!.loop_limit || 100,
          context: { trigger_type: "lead_created" },
        });

        assert(execResult.success, `Execution failed: ${execResult.error}`);
        assert(execResult.status === "completed", `Expected completed, got ${execResult.status}`);
        assert(execResult.stepsExecuted >= 2, `Expected >= 2 steps, got ${execResult.stepsExecuted}`);

        // 5. Verify tag was added
        const { data: tags } = await supabase.from("lead_tags")
          .select("tag:tags(name)").eq("lead_id", leadId);
        const tagNames = tags?.map((t: { tag: { name: string } | null }) => t.tag?.name) || [];
        assert(tagNames.includes(tagName), `Tag ${tagName} not found on lead after E2E execution`);

        // 6. Verify execution steps were recorded
        const { data: steps } = await supabase.from("workflow_execution_steps")
          .select("node_type, status").eq("execution_id", execution.id);
        assert(steps != null && steps.length >= 2, `Expected >= 2 steps, got ${steps?.length}`);
      },
    },
    {
      name: "E2E: condition false path skips action",
      fn: async () => {
        const tagName = `${TEST_PREFIX}e2e_skip_${Date.now()}`;

        const definition = {
          nodes: [
            { id: "t1", type: "trigger", data: { label: "Trigger", triggerType: "lead_created", config: {} }, position: { x: 0, y: 0 } },
            { id: "c1", type: "condition", data: { label: "Score > 1000", field: "score", operator: "greater_than", value: "1000" }, position: { x: 0, y: 100 } },
            { id: "a1", type: "action", data: { label: "Add Tag", actionType: "add_tag", tagName }, position: { x: -100, y: 200 } },
            { id: "e1", type: "end", data: { label: "Fim" }, position: { x: 100, y: 200 } },
          ],
          edges: [
            { id: "e-t1-c1", source: "t1", target: "c1" },
            { id: "e-c1-a1", source: "c1", target: "a1", sourceHandle: "source-true" },
            { id: "e-c1-e1", source: "c1", target: "e1", sourceHandle: "source-false" },
          ],
        };

        const wfId = await createTestWorkflow(supabase, orgId, "lead_created", {}, definition);
        const leadId = await createTestLead(supabase, orgId, { qualification_score: 50 });

        // Fire and execute
        await fireTrigger({ supabase, organizationId: orgId, triggerType: "lead_created", leadId, context: {} });
        await new Promise((r) => setTimeout(r, 300));

        const { data: execs } = await supabase.from("workflow_executions")
          .select("id").eq("workflow_id", wfId).eq("lead_id", leadId).limit(1);

        assert(execs != null && execs.length > 0, "No execution found");

        const { executeWorkflow } = await import("../_shared/workflow-executor.ts");
        const { data: wf } = await supabase.from("workflows").select("definition, loop_limit").eq("id", wfId).single();

        const execResult = await executeWorkflow({
          supabase, executionId: execs[0].id, workflowId: wfId, organizationId: orgId, leadId,
          definition: wf!.definition, loopLimit: wf!.loop_limit || 100,
          context: { trigger_type: "lead_created" },
        });

        assert(execResult.success, `Execution failed: ${execResult.error}`);

        // Tag should NOT have been added (condition was false)
        const { data: tags } = await supabase.from("lead_tags")
          .select("tag:tags(name)").eq("lead_id", leadId);
        const tagNames = tags?.map((t: { tag: { name: string } | null }) => t.tag?.name) || [];
        assert(!tagNames.includes(tagName), `Tag ${tagName} should NOT have been added (false path)`);
      },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // ── Safety check: block production ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const isProduction = supabaseUrl.includes("prod") || Deno.env.get("ENVIRONMENT") === "production";
  const testSecret = req.headers.get("x-test-secret");
  const TEST_MODE_SECRET = Deno.env.get("TEST_MODE_SECRET");

  if (isProduction && testSecret !== TEST_MODE_SECRET) {
    return new Response(
      JSON.stringify({ error: "Test suite blocked in production. Set TEST_MODE_SECRET header to override." }),
      { status: 403, headers },
    );
  }

  // ── Auth ──
  const authHeader = req.headers.get("authorization");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  const supabase = createClient(supabaseUrl, SUPABASE_SERVICE_ROLE_KEY);

  // ── Parse request ──
  let suite = "all";
  let providedOrgId: string | null = null;
  try {
    const body = await req.json();
    suite = body.suite || "all";
    providedOrgId = body.org_id || null;
  } catch {
    // defaults
  }

  const globalStart = Date.now();
  const report: TestReport = {
    summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    triggers: [],
    conditions: [],
    actions: [],
    e2e: [],
    duration_ms: 0,
  };

  // ── Create isolated test org ──
  let orgId: string;
  let cleanupOrg = false;
  if (providedOrgId) {
    orgId = providedOrgId;
  } else {
    orgId = await createTestOrg(supabase);
    cleanupOrg = true;
  }

  try {
    // ── Run condition tests (pure, no DB) ──
    if (suite === "all" || suite === "conditions") {
      const conditionTests = buildConditionTests();
      for (const test of conditionTests) {
        const result = await runTest(test.name, test.fn);
        report.conditions.push(result);
      }
    }

    // ── Run trigger tests ──
    if (suite === "all" || suite === "triggers") {
      const triggerTests = buildTriggerTests(supabase, orgId);
      for (const test of triggerTests) {
        const result = await runTest(test.name, test.fn);
        report.triggers.push(result);
      }
    }

    // ── Run action tests ──
    if (suite === "all" || suite === "actions") {
      const actionTests = buildActionTests(supabase, orgId);
      for (const test of actionTests) {
        const result = await runTest(test.name, test.fn);
        report.actions.push(result);
      }
    }

    // ── Run E2E tests ──
    if (suite === "all" || suite === "e2e") {
      const e2eTests = buildE2eTests(supabase, orgId);
      for (const test of e2eTests) {
        const result = await runTest(test.name, test.fn);
        report.e2e.push(result);
      }
    }
  } finally {
    // ── Cleanup ──
    if (cleanupOrg) {
      try {
        await cleanupTestData(supabase, orgId);
      } catch (err) {
        console.warn("[test-workflow-system] Cleanup error:", err);
      }
    }
  }

  // ── Summarize ──
  const all = [...report.conditions, ...report.triggers, ...report.actions, ...report.e2e];
  report.summary.total = all.length;
  report.summary.passed = all.filter((r) => r.status === "passed").length;
  report.summary.failed = all.filter((r) => r.status === "failed").length;
  report.summary.skipped = all.filter((r) => r.status === "skipped").length;
  report.duration_ms = Date.now() - globalStart;

  const statusCode = report.summary.failed > 0 ? 200 : 200; // Always 200 — failures are in the report

  return new Response(JSON.stringify(report, null, 2), { status: statusCode, headers });
});
