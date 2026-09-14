// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";

function makeInput(overrides: Record<string, unknown> = {}) {
  const { sb } = createMockSupabase();
  return {
    supabase: sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params: { date: "2026-06-01T14:00:00Z" },
    ...overrides,
  };
}

describe("scheduleMeeting — shared action handler", () => {
  it("handler exists and is exported from the registry", async () => {
    const { scheduleMeeting } = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    expect(scheduleMeeting).toBeDefined();
    expect(typeof scheduleMeeting).toBe("function");
  });

  it("creates a real meeting, with start, end, organization and lead", async () => {
    const { scheduleMeeting } = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    const { sb, getInserted, mockTable } = createMockSupabase();
    mockTable("team_members", [{id:"user-abc",organization_id:"org-1",user_id:"auth-user-abc"}]);

    const result = await scheduleMeeting({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { date: "2026-06-01T14:00:00Z" },
    });

    expect(result.success).toBe(true);
    const inserted = getInserted("meetings");
    expect(inserted.length).toBe(1);
    expect(inserted[0]).toMatchObject({
      lead_id: "lead-1",
      organization_id: "org-1",
      start_at: "2026-06-01T14:00:00.000Z",
      end_at: "2026-06-01T15:00:00.000Z",
      event_type: "meeting",
      status: "scheduled",
    });
  });

  it("includes notes as description when provided", async () => {
    const { scheduleMeeting } = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    const { sb, getInserted, mockTable } = createMockSupabase();
    mockTable("team_members", [{id:"user-abc",organization_id:"org-1",user_id:"auth-user-abc"}]);

    await scheduleMeeting({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { date: "2026-06-01T14:00:00Z", notes: "Discutir proposta comercial" },
    });

    const inserted = getInserted("meetings");
    expect(inserted[0].description).toBe("Discutir proposta comercial");
  });

  it("resolves team member to auth user for created_by", async () => {
    const { scheduleMeeting } = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    const { sb, getInserted, mockTable } = createMockSupabase();
    mockTable("team_members", [{id:"user-abc",organization_id:"org-1",user_id:"auth-user-abc"}]);

    await scheduleMeeting({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { date: "2026-06-01T14:00:00Z", assigned_to: "user-abc" },
    });

    const inserted = getInserted("meetings");
    expect(inserted[0].created_by).toBe("auth-user-abc");
  });

  it("returns { success: true } on successful insert", async () => {
    const { scheduleMeeting } = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    const { sb } = createMockSupabase();

    const result = await scheduleMeeting({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { date: "2026-06-01T14:00:00Z" },
    });

    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
  });

  it("returns { success: false, error } when insert fails", async () => {
    const { scheduleMeeting } = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    // Create a supabase mock that always errors on insert
    const errorSb = {
      from: (_table: string) => ({
        insert: (_data: unknown) => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { message: "DB constraint violated" } }),
            maybeSingle: () => Promise.resolve({ data: null, error: { message: "DB constraint violated" } }),
            then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "DB constraint violated" } }),
          }),
          then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "DB constraint violated" } }),
          catch: () => Promise.resolve({ data: null, error: { message: "DB constraint violated" } }),
        }),
      }),
    };

    const result = await scheduleMeeting({
      supabase: errorSb as any,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { date: "2026-06-01T14:00:00Z" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("validates required param date — returns error if missing", async () => {
    const { scheduleMeeting } = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    const { sb } = createMockSupabase();

    const result = await scheduleMeeting({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("date");
  });

  it("validates required leadId — returns error if null", async () => {
    const { scheduleMeeting } = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    const { sb } = createMockSupabase();

    const result = await scheduleMeeting({
      supabase: sb,
      organizationId: "org-1",
      leadId: null,
      conversationId: null,
      params: { date: "2026-06-01T14:00:00Z" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("combines date + time into proper due_date when time provided", async () => {
    const { scheduleMeeting } = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    const { sb, getInserted, mockTable } = createMockSupabase();
    mockTable("team_members", [{id:"user-abc",organization_id:"org-1",user_id:"auth-user-abc"}]);

    await scheduleMeeting({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { date: "2026-06-01", time: "14:30" },
    });

    const inserted = getInserted("meetings");
    expect(inserted[0].start_at).toBe("2026-06-01T14:30:00.000Z");
  });
});

it("reuses an automation appointment on retry", async () => {
  const { scheduleMeeting } = await import("../../supabase/functions/_shared/action-handlers/schedule-meeting");
  const { sb, mockTable, getInserted } = createMockSupabase();
  mockTable("meetings", [{id:"existing",organization_id:"org-1",external_ref:"automation:1",meet_link:null}]);
  const result = await scheduleMeeting(makeInput({supabase:sb,params:{date:"2026-06-01T14:00:00Z",external_ref:"automation:1"}}));
  expect(result.data).toMatchObject({meeting_id:"existing",idempotent:true});
  expect(getInserted("meetings")).toEqual([]);
});

it("refuses to attach an appointment to a different tenant's business", async () => {
  const { scheduleMeeting } = await import("../../supabase/functions/_shared/action-handlers/schedule-meeting");
  const { sb, mockTable, getInserted } = createMockSupabase();
  mockTable("pipeline_entries", [{id:"entry",organization_id:"other-org",lead_id:"lead-1",pipeline_id:"pipe",deal_id:null}]);
  const result = await scheduleMeeting(makeInput({supabase:sb,entryId:"entry"}));
  expect(result.success).toBe(false);
  expect(getInserted("meetings")).toEqual([]);
});
