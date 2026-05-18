// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import type { ActionInput } from "../../../supabase/functions/_shared/action-handlers/types";
import {
  addToCampaign,
  removeFromCampaign,
  moveCampaignStage,
  pauseCampaignSequence,
  resumeCampaignSequence,
} from "../../../supabase/functions/_shared/action-handlers/campaign-operations";

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

// ─── addToCampaign ──────────────────────────────────────────────────────────

describe("addToCampaign", () => {
  it("fails when campaignId missing", async () => {
    const result = await addToCampaign(makeInput({}));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("upserts campanha_leads with first stage", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("campanha_stages", [
      { id: "stage-1", campanha_id: "camp-1", position: 1 },
      { id: "stage-2", campanha_id: "camp-1", position: 2 },
    ]);

    const result = await addToCampaign({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { campaignId: "camp-1" },
    });

    expect(result.success).toBe(true);
    const upserted = getInserted("campanha_leads");
    expect(upserted.length).toBe(1);
    expect(upserted[0]).toMatchObject({
      campanha_id: "camp-1",
      lead_id: "lead-1",
      stage_id: "stage-1",
    });
  });

  it("upserts with null stage_id when no stages exist", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("campanha_stages", []);

    const result = await addToCampaign({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { campaignId: "camp-1" },
    });

    expect(result.success).toBe(true);
    const upserted = getInserted("campanha_leads");
    expect(upserted[0].stage_id).toBeNull();
  });
});

// ─── removeFromCampaign ─────────────────────────────────────────────────────

describe("removeFromCampaign", () => {
  it("fails when campaignId missing", async () => {
    const result = await removeFromCampaign(makeInput({}));
    expect(result.success).toBe(false);
  });

  it("succeeds with valid campaignId", async () => {
    const result = await removeFromCampaign(makeInput({ campaignId: "camp-1" }));
    expect(result.success).toBe(true);
  });
});

// ─── moveCampaignStage ──────────────────────────────────────────────────────

describe("moveCampaignStage", () => {
  it("fails when campaignId missing", async () => {
    const result = await moveCampaignStage(makeInput({}));
    expect(result.success).toBe(false);
  });

  it("resolves stage by name when stageId not provided", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanha_stages", [
      { id: "stage-99", campanha_id: "camp-1", name: "Qualificado" },
    ]);

    const result = await moveCampaignStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { campaignId: "camp-1", campaignStageName: "Qualificado" },
    });

    expect(result.success).toBe(true);
  });

  it("uses stageId directly when provided", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanha_stages", []);

    const result = await moveCampaignStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { campaignId: "camp-1", campaignStageId: "stage-direct" },
    });

    expect(result.success).toBe(true);
  });

  it("fails when stage not found", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanha_stages", []);

    const result = await moveCampaignStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { campaignId: "camp-1", campaignStageName: "Inexistente" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

// ─── pauseCampaignSequence ──────────────────────────────────────────────────

describe("pauseCampaignSequence", () => {
  it("fails when campaignId missing", async () => {
    const result = await pauseCampaignSequence(makeInput({}));
    expect(result.success).toBe(false);
  });

  it("succeeds with valid campaignId", async () => {
    const result = await pauseCampaignSequence(makeInput({ campaignId: "camp-1" }));
    expect(result.success).toBe(true);
  });
});

// ─── resumeCampaignSequence ─────────────────────────────────────────────────

describe("resumeCampaignSequence", () => {
  it("fails when campaignId missing", async () => {
    const result = await resumeCampaignSequence(makeInput({}));
    expect(result.success).toBe(false);
  });

  it("succeeds with valid campaignId", async () => {
    const result = await resumeCampaignSequence(makeInput({ campaignId: "camp-1" }));
    expect(result.success).toBe(true);
  });
});
