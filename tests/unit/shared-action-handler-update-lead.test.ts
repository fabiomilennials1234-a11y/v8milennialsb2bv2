// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
import { updateLead } from "../../supabase/functions/_shared/action-handlers/update-lead";
import type { ActionInput } from "../../supabase/functions/_shared/action-handlers/types";

function makeInput(overrides: Partial<ActionInput> & { params?: Record<string, unknown> } = {}): ActionInput {
  const { sb } = createMockSupabase();
  return {
    supabase: sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params: { fields: { name: "Updated Name" } },
    ...overrides,
  };
}

describe("updateLead — shared action handler", () => {
  it("is exported from the action-handlers registry", async () => {
    const mod = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    expect(mod.updateLead).toBeDefined();
    expect(typeof mod.updateLead).toBe("function");
  });

  it("updates allowed fields on leads table scoped by lead_id + organization_id", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", name: "Old Name", organization_id: "org-1" }]);

    const result = await updateLead({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { fields: { name: "New Name", email: "new@test.com" } },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("2");
    expect(result.data?.updated_fields).toEqual(["name", "email"]);
    expect(result.data?.count).toBe(2);
  });

  it("returns { success: true, message: 'Updated N fields' } on success", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", organization_id: "org-1" }]);

    const result = await updateLead({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { fields: { phone: "11999999999" } },
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe("Updated 1 field");
  });

  it("rejects disallowed fields — strips them, updates only allowed ones", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", organization_id: "org-1" }]);

    const result = await updateLead({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        fields: {
          name: "Safe",
          organization_id: "hacker-org",
          id: "hacker-id",
          created_at: "2020-01-01",
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.updated_fields).toEqual(["name"]);
    expect(result.data?.count).toBe(1);
  });

  it("returns { success: false, error } when fields param is empty or all fields rejected", async () => {
    const { sb } = createMockSupabase();

    // All disallowed
    const result1 = await updateLead({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { fields: { organization_id: "hack", id: "hack", created_at: "hack" } },
    });
    expect(result1.success).toBe(false);
    expect(result1.error).toContain("No allowed fields");

    // Empty fields object
    const result2 = await updateLead({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { fields: {} },
    });
    expect(result2.success).toBe(false);
    expect(result2.error).toContain("required");

    // Missing fields param entirely
    const result3 = await updateLead({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {},
    });
    expect(result3.success).toBe(false);
    expect(result3.error).toContain("required");
  });

  it("returns { success: false, error } when DB update fails", async () => {
    // Create a mock that returns an error from .update()
    const mockFrom = () => ({
      update: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: null, error: { message: "RLS violation", code: "42501" } }),
        }),
      }),
    });
    const fakeSb = { from: mockFrom } as any;

    const result = await updateLead({
      supabase: fakeSb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { fields: { name: "Will Fail" } },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("DB update failed");
    expect(result.error).toContain("RLS violation");
  });

  it("handles partial allowed fields — mix of allowed + disallowed applies only allowed", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", organization_id: "org-1" }]);

    const result = await updateLead({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        fields: {
          name: "Valid",
          email: "valid@test.com",
          temperature: "hot",
          qualification_score: 90,  // disallowed
          pipe_whatsapp: "novo",    // disallowed
          sdr_id: "tm-1",          // disallowed
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.updated_fields).toEqual(["name", "email", "temperature"]);
    expect(result.data?.count).toBe(3);
    expect(result.message).toBe("Updated 3 fields");
  });
});
