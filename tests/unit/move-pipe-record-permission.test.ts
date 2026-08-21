// @vitest-environment node
/**
 * Unit tests for move-pipe-record permission gate (#188).
 *
 * Validates that executeAdvanceStage and executeUpdatePipelineStage
 * enforce move_pipe_record permission when a userId is provided.
 * TDD: red-green-refactor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

// Mock logger
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));

// Mock createClient for getServiceClient fallback inside permission_engine
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

// Mock pipeline-adapter (avoid real DB calls)
vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  upsertPipeEntry: vi.fn().mockResolvedValue("entry-123"),
}));

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

import {
  executeAdvanceStage,
  executeUpdatePipelineStage,
} from "../../supabase/functions/_shared/actions/move-card";

describe("move-pipe-record permission gate", () => {
  describe("executeAdvanceStage", () => {
    it("returns error when assertPermission returns { allowed: false }", async () => {
      const { sb, mockTable } = createMockSupabase();
      // Setup member without permission
      mockTable("team_members", [
        { id: "tm1", user_id: "u-member", organization_id: "org-1", role: "member", is_active: true },
      ]);
      // Deny move_pipe_record via feature_permissions (default_value: false, no override)
      mockTable("feature_permissions", [
        { key: "pipeline.move_cards", is_admin_only: false, default_value: false },
      ]);

      const result = await executeAdvanceStage(
        sb,
        { lead_id: "lead-1", target_stage: "abordado", target_pipe: "whatsapp" },
        "org-1",
        { userId: "u-member" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission/i);
    });

    it("proceeds normally when assertPermission returns { allowed: true }", async () => {
      const { sb, mockTable } = createMockSupabase();
      // Admin user — always allowed
      mockTable("team_members", [
        { id: "tm1", user_id: "u-admin", organization_id: "org-1", role: "admin", is_active: true },
      ]);
      mockTable("pipeline_stages", [
        { stage_key: "abordado", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
      ]);

      const result = await executeAdvanceStage(
        sb,
        { lead_id: "lead-1", target_stage: "abordado", target_pipe: "whatsapp" },
        "org-1",
        { userId: "u-admin" },
      );

      expect(result.success).toBe(true);
    });

    it("403 result body contains error and reason fields", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("team_members", [
        { id: "tm1", user_id: "u-member", organization_id: "org-1", role: "member", is_active: true },
      ]);
      mockTable("feature_permissions", [
        { key: "pipeline.move_cards", is_admin_only: false, default_value: false },
      ]);

      const result = await executeAdvanceStage(
        sb,
        { lead_id: "lead-1", target_stage: "abordado", target_pipe: "whatsapp" },
        "org-1",
        { userId: "u-member" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
      expect(result.data?.reason).toBeDefined();
    });

    it("permission check uses action 'move_pipe_record'", async () => {
      const { sb, mockTable } = createMockSupabase();
      // Member with explicit move_pipe_record denied
      mockTable("team_members", [
        { id: "tm1", user_id: "u-member", organization_id: "org-1", role: "member", is_active: true },
      ]);
      mockTable("feature_permissions", [
        { key: "pipeline.move_cards", is_admin_only: false, default_value: false },
      ]);

      const result = await executeAdvanceStage(
        sb,
        { lead_id: "lead-1", target_stage: "novo", target_pipe: "whatsapp" },
        "org-1",
        { userId: "u-member" },
      );

      // Denied specifically because of pipeline.move_cards feature permission
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission|permiss/i);
    });

    it("admin user passes permission check (existing behavior preserved)", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("team_members", [
        { id: "tm1", user_id: "u-admin", organization_id: "org-1", role: "admin", is_active: true },
      ]);
      mockTable("pipeline_stages", [
        { stage_key: "respondeu", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
      ]);

      const result = await executeAdvanceStage(
        sb,
        { lead_id: "lead-1", target_stage: "respondeu", target_pipe: "whatsapp" },
        "org-1",
        { userId: "u-admin" },
      );

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
    });

    it("skips permission check when no userId provided (AI/automation)", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("pipeline_stages", [
        { stage_key: "abordado", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
      ]);

      // No userId — should proceed without permission check
      const result = await executeAdvanceStage(
        sb,
        { lead_id: "lead-1", target_stage: "abordado", target_pipe: "whatsapp" },
        "org-1",
      );

      expect(result.success).toBe(true);
    });
  });

  describe("executeUpdatePipelineStage", () => {
    it("returns error when user lacks permission", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("team_members", [
        { id: "tm1", user_id: "u-member", organization_id: "org-1", role: "member", is_active: true },
      ]);
      mockTable("feature_permissions", [
        { key: "pipeline.move_cards", is_admin_only: false, default_value: false },
      ]);

      const result = await executeUpdatePipelineStage(
        sb,
        { lead_id: "lead-1", new_stage: "abordado" },
        "org-1",
        { userId: "u-member" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission/i);
    });

    it("proceeds when admin user calls", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("team_members", [
        { id: "tm1", user_id: "u-admin", organization_id: "org-1", role: "admin", is_active: true },
      ]);

      const result = await executeUpdatePipelineStage(
        sb,
        { lead_id: "lead-1", new_stage: "abordado" },
        "org-1",
        { userId: "u-admin" },
      );

      expect(result.success).toBe(true);
    });

    it("skips permission check when no userId (automation)", async () => {
      const { sb, mockTable } = createMockSupabase();

      const result = await executeUpdatePipelineStage(
        sb,
        { lead_id: "lead-1", new_stage: "abordado" },
        "org-1",
      );

      expect(result.success).toBe(true);
    });
  });
});
