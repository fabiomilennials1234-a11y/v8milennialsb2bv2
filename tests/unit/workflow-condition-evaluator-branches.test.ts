/**
 * Coverage for evaluateCondition + private helpers (getCustomFieldValue,
 * getLeadTags). Complements workflow-condition-evaluator.test.ts which
 * covers the pure `compare()` function.
 */

import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../../supabase/functions/_shared/workflow-condition-evaluator";
import { createMockSupabase } from "../helpers/supabase-mock";

const LEAD = {
  id: "lead-1",
  organization_id: "org-1",
  name: "Ada",
  email: "ada@x.com",
  pipe_whatsapp: "abordado",
  qualification_score: 82,
  rating: 4,
  segment: "B2B",
};

describe("evaluateCondition — lead lookup", () => {
  it("returns false when lead not found", async () => {
    const { sb } = createMockSupabase();
    const result = await evaluateCondition(sb, "missing", {
      field: "name",
      operator: "equals",
      value: "Ada",
    });
    expect(result).toBe(false);
  });
});

describe("evaluateCondition — field resolution", () => {
  it("resolves default field from lead row", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "segment",
      operator: "equals",
      value: "B2B",
    });
    expect(result).toBe(true);
  });

  it("field='stage' maps to pipe_whatsapp", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "stage",
      operator: "in_stage",
      value: "abordado",
    });
    expect(result).toBe(true);
  });

  it("field='stage' falls back to empty string when pipe_whatsapp missing", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", organization_id: "org-1" }]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "stage",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });

  it("field='score' maps to qualification_score", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "score",
      operator: "greater_than",
      value: "80",
    });
    expect(result).toBe(true);
  });

  it("field='score' defaults to 0 when qualification_score null", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", organization_id: "org-1" }]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "score",
      operator: "equals",
      value: "0",
    });
    expect(result).toBe(true);
  });

  it("unknown non-prefix field returns undefined → is_empty=true", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "nonexistent_field",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });
});

describe("evaluateCondition — tags field", () => {
  it("returns joined tag names for has_tag", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_tags", [
      { lead_id: "lead-1", tag: { name: "Ouro" } },
      { lead_id: "lead-1", tag: { name: "VIP" } },
    ]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "tags",
      operator: "has_tag",
      value: "ouro",
    });
    expect(result).toBe(true);
  });

  it("returns empty when lead has no tags", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_tags", []);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "tags",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });

  it("skips tags with null name", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_tags", [
      { lead_id: "lead-1", tag: { name: "Ouro" } },
      { lead_id: "lead-1", tag: null },
    ]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "tags",
      operator: "contains",
      value: "ouro",
    });
    expect(result).toBe(true);
  });
});

describe("evaluateCondition — custom fields", () => {
  it("resolves custom.cnpj via lookup + value", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_custom_fields", [
      { id: "cf-cnpj", organization_id: "org-1", field_name: "cnpj" },
    ]);
    mockTable("lead_custom_field_values", [
      { lead_id: "lead-1", field_id: "cf-cnpj", value: "12.345.678/0001-90" },
    ]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "custom.cnpj",
      operator: "contains",
      value: "12.345",
    });
    expect(result).toBe(true);
  });

  it("returns empty string when custom field not defined", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_custom_fields", []);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "custom.nope",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });

  it("returns empty when value row missing", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("lead_custom_fields", [
      { id: "cf-vazio", organization_id: "org-1", field_name: "vazio" },
    ]);
    mockTable("lead_custom_field_values", []);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "custom.vazio",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });

  it("returns empty when organization_id missing on lead", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", name: "Orphan" }]);
    const result = await evaluateCondition(sb, "lead-1", {
      field: "custom.any",
      operator: "is_empty",
      value: "",
    });
    expect(result).toBe(true);
  });
});
