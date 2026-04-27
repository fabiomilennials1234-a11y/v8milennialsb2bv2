import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

import {
  getCampaignResponsibleAssignment,
  getCampaignLeadAssignment,
  getCampaignCloserAssignment,
  type DistributionMode,
  type CampaignDistributionSettings,
} from "../../supabase/functions/_shared/campaign-distribution";

describe("getCampaignResponsibleAssignment", () => {
  it("returns null when campaign not found", async () => {
    const { sb } = createMockSupabase();
    // Default: table "campanhas" is empty, single() returns null
    const result = await getCampaignResponsibleAssignment(sb, "nonexistent");
    expect(result).toBeNull();
  });

  it("returns lead_assigned_to when mode is null", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanhas", [
      { id: "camp-1", lead_distribution_mode: null, lead_assigned_to: "member-1" },
    ]);
    const result = await getCampaignResponsibleAssignment(sb, "camp-1");
    expect(result).toBe("member-1");
  });

  it("returns null when mode is null and no lead_assigned_to", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanhas", [
      { id: "camp-1", lead_distribution_mode: null, lead_assigned_to: null },
    ]);
    const result = await getCampaignResponsibleAssignment(sb, "camp-1");
    expect(result).toBeNull();
  });

  it("returns lead_assigned_to when mode is 'single'", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanhas", [
      { id: "camp-1", lead_distribution_mode: "single", lead_assigned_to: "member-5" },
    ]);
    const result = await getCampaignResponsibleAssignment(sb, "camp-1");
    expect(result).toBe("member-5");
  });

  it("returns null when no members in campaign for random mode", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanhas", [
      { id: "camp-1", lead_distribution_mode: "random", lead_assigned_to: null },
    ]);
    // campanha_members is empty by default
    const result = await getCampaignResponsibleAssignment(sb, "camp-1");
    expect(result).toBeNull();
  });

  it("returns a random member for 'random' mode", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanhas", [
      { id: "camp-1", lead_distribution_mode: "random", lead_assigned_to: null },
    ]);
    mockTable("campanha_members", [
      { team_member_id: "m1", campanha_id: "camp-1" },
      { team_member_id: "m2", campanha_id: "camp-1" },
      { team_member_id: "m3", campanha_id: "camp-1" },
    ]);
    const result = await getCampaignResponsibleAssignment(sb, "camp-1");
    expect(["m1", "m2", "m3"]).toContain(result);
  });

  it("returns RPC result for 'round_robin' mode", async () => {
    const { sb, mockTable, mockRpc } = createMockSupabase();
    mockTable("campanhas", [
      { id: "camp-1", lead_distribution_mode: "round_robin", lead_assigned_to: null },
    ]);
    mockTable("campanha_members", [
      { team_member_id: "m1", campanha_id: "camp-1" },
      { team_member_id: "m2", campanha_id: "camp-1" },
    ]);
    mockRpc("distribute_campaign_round_robin", "m2");
    const result = await getCampaignResponsibleAssignment(sb, "camp-1");
    expect(result).toBe("m2");
  });

  it("returns null when round_robin RPC fails", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanhas", [
      { id: "camp-1", lead_distribution_mode: "round_robin", lead_assigned_to: null },
    ]);
    mockTable("campanha_members", [
      { team_member_id: "m1", campanha_id: "camp-1" },
    ]);
    // RPC not mocked → returns error
    const result = await getCampaignResponsibleAssignment(sb, "camp-1");
    // rpc returns error by default in mock, should return null
    expect(result).toBeNull();
  });

  it("returns null for unknown distribution mode", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanhas", [
      { id: "camp-1", lead_distribution_mode: "unknown_mode", lead_assigned_to: null },
    ]);
    mockTable("campanha_members", [
      { team_member_id: "m1", campanha_id: "camp-1" },
    ]);
    const result = await getCampaignResponsibleAssignment(sb, "camp-1");
    expect(result).toBeNull();
  });
});

describe("getCampaignLeadAssignment (deprecated)", () => {
  it("delegates to getCampaignResponsibleAssignment", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanhas", [
      { id: "camp-1", lead_distribution_mode: "single", lead_assigned_to: "m1" },
    ]);
    const result = await getCampaignLeadAssignment(sb, "camp-1");
    expect(result).toBe("m1");
  });
});

describe("getCampaignCloserAssignment (deprecated)", () => {
  it("delegates to getCampaignResponsibleAssignment", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanhas", [
      { id: "camp-1", lead_distribution_mode: "single", lead_assigned_to: "m2" },
    ]);
    const result = await getCampaignCloserAssignment(sb, "camp-1");
    expect(result).toBe("m2");
  });
});

describe("Type exports", () => {
  it("DistributionMode accepts valid values", () => {
    const modes: DistributionMode[] = ["random", "round_robin", "single", null];
    expect(modes).toHaveLength(4);
  });

  it("CampaignDistributionSettings has required fields", () => {
    const settings: CampaignDistributionSettings = {
      lead_distribution_mode: "random",
      lead_assigned_to: null,
    };
    expect(settings.lead_distribution_mode).toBe("random");
  });
});
