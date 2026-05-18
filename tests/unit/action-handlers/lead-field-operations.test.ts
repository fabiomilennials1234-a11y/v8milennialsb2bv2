// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import {
  updateLeadField,
  updateCustomField,
  updateRating,
} from "../../../supabase/functions/_shared/action-handlers/lead-field-operations";
import type { ActionInput } from "../../../supabase/functions/_shared/action-handlers/types";

function makeInput(params: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}): ActionInput {
  const { sb } = createMockSupabase();
  return {
    supabase: sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params,
    ...overrides,
  };
}

// ─── updateLeadField ──────────────────────────────────────────────────────

describe("updateLeadField", () => {
  it("returns error when fieldName missing", async () => {
    const result = await updateLeadField(makeInput({ fieldValue: "foo" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("field");
  });

  it("returns error when leadId is null", async () => {
    const result = await updateLeadField(makeInput({ fieldName: "company", fieldValue: "Acme" }, { leadId: null }));
    expect(result.success).toBe(false);
  });

  it("updates the lead field and returns success", async () => {
    const { sb } = createMockSupabase();
    const result = await updateLeadField({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { fieldName: "company", fieldValue: "Acme Corp" },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("company");
    expect(result.data).toMatchObject({ fieldName: "company", fieldValue: "Acme Corp" });
  });

  it("handles empty fieldValue (sets to empty string)", async () => {
    const result = await updateLeadField(makeInput({ fieldName: "notes" }));
    expect(result.success).toBe(true);
    expect(result.data?.fieldValue).toBe("");
  });
});

// ─── updateCustomField ────────────────────────────────────────────────────

describe("updateCustomField", () => {
  it("returns error when customFieldName missing", async () => {
    const result = await updateCustomField(makeInput({ customFieldValue: "bar" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("field");
  });

  it("returns error when leadId is null", async () => {
    const result = await updateCustomField(makeInput({ customFieldName: "cargo" }, { leadId: null }));
    expect(result.success).toBe(false);
  });

  it("returns error when custom field definition not found in org", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("lead_custom_fields", []);

    const result = await updateCustomField({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { customFieldName: "cargo", customFieldValue: "CTO" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("cargo");
    expect(result.error).toContain("not found");
  });

  it("upserts custom field value when field definition exists", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("lead_custom_fields", [
      { id: "cf-1", organization_id: "org-1", field_name: "cargo" },
    ]);

    const result = await updateCustomField({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { customFieldName: "cargo", customFieldValue: "CTO" },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("cargo");
    const upserted = getInserted("lead_custom_field_values");
    expect(upserted.length).toBe(1);
    expect(upserted[0]).toMatchObject({ lead_id: "lead-1", field_id: "cf-1", value: "CTO" });
  });
});

// ─── updateRating ─────────────────────────────────────────────────────────

describe("updateRating", () => {
  it("returns error when leadId is null", async () => {
    const result = await updateRating(makeInput({ ratingValue: 5 }, { leadId: null }));
    expect(result.success).toBe(false);
  });

  it("updates rating and returns success", async () => {
    const { sb } = createMockSupabase();
    const result = await updateRating({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { ratingValue: 7 },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("7");
  });

  it("clamps rating to 0-10 range — above 10", async () => {
    const result = await updateRating(makeInput({ ratingValue: 15 }));
    expect(result.success).toBe(true);
    expect(result.message).toContain("10");
  });

  it("clamps rating to 0-10 range — below 0", async () => {
    const result = await updateRating(makeInput({ ratingValue: -3 }));
    expect(result.success).toBe(true);
    expect(result.message).toContain("0");
  });

  it("defaults to 0 when ratingValue is undefined", async () => {
    const result = await updateRating(makeInput({}));
    expect(result.success).toBe(true);
    expect(result.message).toContain("0");
  });
});
