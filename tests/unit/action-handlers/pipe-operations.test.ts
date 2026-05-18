// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import {
  duplicateToPipe,
  removeFromPipe,
  markAsLost,
} from "../../../supabase/functions/_shared/action-handlers/pipe-operations";
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

// ─── duplicateToPipe ──────────────────────────────────────────────────────

describe("duplicateToPipe", () => {
  it("returns error when leadId is null", async () => {
    const result = await duplicateToPipe(makeInput({ targetPipeType: "whatsapp" }, { leadId: null }));
    expect(result.success).toBe(false);
  });

  it("returns error when lead not found", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", []);
    const result = await duplicateToPipe({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-missing",
      conversationId: null,
      params: { targetPipeType: "whatsapp", targetPipeStage: "novo" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("upserts pipeline entry for whatsapp pipe + updates leads.pipe_whatsapp", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", name: "Test", organization_id: "org-1" }]);
    mockTable("pipelines", [{ id: "pipe-wpp", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_entries", []);

    const result = await duplicateToPipe({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { targetPipeType: "whatsapp", targetPipeStage: "agendado" },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("whatsapp");
    expect(result.message).toContain("agendado");
  });

  it("upserts pipeline entry for confirmacao pipe (no leads.pipe_whatsapp update)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", name: "Test", organization_id: "org-1" }]);
    mockTable("pipelines", [{ id: "pipe-conf", organization_id: "org-1", slug: "confirmacao", type: "system" }]);
    mockTable("pipeline_entries", []);

    const result = await duplicateToPipe({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { targetPipeType: "confirmacao", targetPipeStage: "marcada" },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("confirmacao");
  });

  it("defaults to whatsapp/novo when params empty", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", name: "Test", organization_id: "org-1" }]);
    mockTable("pipelines", [{ id: "pipe-wpp", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_entries", []);

    const result = await duplicateToPipe({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {},
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("whatsapp");
  });
});

// ─── removeFromPipe ───────────────────────────────────────────────────────

describe("removeFromPipe", () => {
  it("returns error when leadId is null", async () => {
    const result = await removeFromPipe(makeInput({ pipeType: "whatsapp" }, { leadId: null }));
    expect(result.success).toBe(false);
  });

  it("removes from whatsapp pipe and clears leads.pipe_whatsapp", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipelines", [{ id: "pipe-wpp", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_entries", [{ id: "entry-1", lead_id: "lead-1", pipeline_id: "pipe-wpp" }]);

    const result = await removeFromPipe({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { pipeType: "whatsapp" },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("whatsapp");
  });

  it("removes from confirmacao pipe (no leads.pipe_whatsapp clear)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipelines", [{ id: "pipe-conf", organization_id: "org-1", slug: "confirmacao", type: "system" }]);
    mockTable("pipeline_entries", [{ id: "entry-1", lead_id: "lead-1", pipeline_id: "pipe-conf" }]);

    const result = await removeFromPipe({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { pipeType: "confirmacao" },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("confirmacao");
  });

  it("defaults to whatsapp when pipeType not provided", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipelines", [{ id: "pipe-wpp", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_entries", []);

    const result = await removeFromPipe({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {},
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("whatsapp");
  });
});

// ─── markAsLost ───────────────────────────────────────────────────────────

describe("markAsLost", () => {
  it("returns error when leadId is null", async () => {
    const result = await markAsLost(makeInput({ pipeType: "propostas" }, { leadId: null }));
    expect(result.success).toBe(false);
  });

  it("marks lead as lost in propostas with loss_reason_id", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipelines", [{ id: "pipe-prop", organization_id: "org-1", slug: "propostas", type: "system" }]);
    mockTable("pipeline_entries", [
      { id: "entry-1", lead_id: "lead-1", pipeline_id: "pipe-prop", stage_key: "enviada" },
    ]);

    const result = await markAsLost({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { pipeType: "propostas", lostReason: "preco" },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("propostas");
  });

  it("logs to lead_history", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("pipelines", [{ id: "pipe-prop", organization_id: "org-1", slug: "propostas", type: "system" }]);
    mockTable("pipeline_entries", [
      { id: "entry-1", lead_id: "lead-1", pipeline_id: "pipe-prop", stage_key: "enviada" },
    ]);

    await markAsLost({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { pipeType: "propostas", lostReason: "preco" },
    });

    const history = getInserted("lead_history");
    expect(history.length).toBe(1);
    expect(history[0]).toMatchObject({
      lead_id: "lead-1",
      organization_id: "org-1",
      action: "marked_lost",
    });
  });

  it("defaults to propostas pipe when pipeType not provided", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipelines", [{ id: "pipe-prop", organization_id: "org-1", slug: "propostas", type: "system" }]);
    mockTable("pipeline_entries", []);

    const result = await markAsLost({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {},
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("propostas");
  });
});
