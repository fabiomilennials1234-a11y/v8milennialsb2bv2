// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import { addTag, removeTag } from "../../../supabase/functions/_shared/action-handlers/tag-operations";
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

// ─── addTag ────────────────────────────────────────────────────────────────

describe("addTag", () => {
  it("returns error when no tag configured (no tagId, no tagName)", async () => {
    const result = await addTag(makeInput({}));
    expect(result.success).toBe(false);
    expect(result.error).toContain("tag");
  });

  it("returns error when leadId is null", async () => {
    const result = await addTag(makeInput({ tagId: "tag-1" }, { leadId: null }));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("upserts lead_tags when tagId provided", async () => {
    const { sb, getInserted } = createMockSupabase();
    const input: ActionInput = {
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { tagId: "tag-abc" },
    };

    const result = await addTag(input);
    expect(result.success).toBe(true);
    const upserted = getInserted("lead_tags");
    expect(upserted.length).toBe(1);
    expect(upserted[0]).toMatchObject({ lead_id: "lead-1", tag_id: "tag-abc" });
  });

  it("resolves tag by name when tagId not provided — existing tag", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("tags", [{ id: "tag-found", name: "Ouro", organization_id: "org-1" }]);

    const input: ActionInput = {
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { tagName: "Ouro" },
    };

    const result = await addTag(input);
    expect(result.success).toBe(true);
    const upserted = getInserted("lead_tags");
    expect(upserted.length).toBe(1);
    expect(upserted[0]).toMatchObject({ tag_id: "tag-found" });
  });

  it("creates new tag when tagName not found", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("tags", []);

    const input: ActionInput = {
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { tagName: "Nova" },
    };

    const result = await addTag(input);
    expect(result.success).toBe(true);
    // tag was created
    const createdTags = getInserted("tags");
    expect(createdTags.length).toBe(1);
    expect(createdTags[0]).toMatchObject({ name: "Nova", organization_id: "org-1" });
    // lead_tags was upserted with the new tag's id
    const upserted = getInserted("lead_tags");
    expect(upserted.length).toBe(1);
  });

  it("returns success message containing tag name", async () => {
    const result = await addTag(makeInput({ tagId: "tag-1", tagName: "VIP" }));
    expect(result.success).toBe(true);
    expect(result.message).toContain("VIP");
  });
});

// ─── removeTag ─────────────────────────────────────────────────────────────

describe("removeTag", () => {
  it("returns error when tag not found (no tagId, no matching tagName)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("tags", []);
    const result = await removeTag({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { tagName: "Inexistente" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error when leadId is null", async () => {
    const result = await removeTag(makeInput({ tagId: "tag-1" }, { leadId: null }));
    expect(result.success).toBe(false);
  });

  it("deletes lead_tags row when tagId provided", async () => {
    const { sb } = createMockSupabase();
    const result = await removeTag({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { tagId: "tag-1" },
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("removed");
  });

  it("resolves tag by name before deleting", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("tags", [{ id: "tag-res", name: "Prata", organization_id: "org-1" }]);
    const result = await removeTag({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { tagName: "Prata" },
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Prata");
  });
});
