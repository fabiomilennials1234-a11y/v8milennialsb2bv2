import { describe, it, expect, vi } from "vitest";

const mockInvoke = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: any[]) => mockInvoke(...a) } },
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { triggerLeadCreatedInCustomPipeline, triggerStageChangedWorkflows } from "@/lib/workflowTrigger";

describe("triggerLeadCreatedInCustomPipeline", () => {
  it("invokes process-workflow-executions", async () => {
    await triggerLeadCreatedInCustomPipeline({ organizationId: "org-1", leadId: "l1", pipelineId: "p1" });
    expect(mockInvoke).toHaveBeenCalledWith("process-workflow-executions", expect.objectContaining({
      body: expect.objectContaining({ mode: "fire_trigger", trigger_type: "lead_created" }),
    }));
  });

  it("handles error gracefully", async () => {
    mockInvoke.mockResolvedValueOnce({ error: { message: "fail" } });
    await triggerLeadCreatedInCustomPipeline({ organizationId: "org-1", leadId: "l1", pipelineId: "p1" });
  });

  it("handles thrown exception", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("network"));
    await triggerLeadCreatedInCustomPipeline({ organizationId: "org-1", leadId: "l1", pipelineId: "p1" });
  });
});

describe("triggerStageChangedWorkflows", () => {
  it("invokes with stage_changed trigger", async () => {
    mockInvoke.mockResolvedValueOnce({ error: null });
    await triggerStageChangedWorkflows({ organizationId: "org-1", leadId: "l1", toStage: "abordado" });
    expect(mockInvoke).toHaveBeenCalledWith("process-workflow-executions", expect.objectContaining({
      body: expect.objectContaining({ trigger_type: "stage_changed" }),
    }));
  });

  it("passes pipe context", async () => {
    mockInvoke.mockResolvedValueOnce({ error: null });
    await triggerStageChangedWorkflows({ organizationId: "org-1", leadId: "l1", pipeType: "pipe_whatsapp", fromStage: "novo", toStage: "abordado" });
  });

  it("handles error gracefully", async () => {
    mockInvoke.mockResolvedValueOnce({ error: { message: "fail" } });
    await triggerStageChangedWorkflows({ organizationId: "org-1", leadId: "l1", toStage: "novo" });
  });

  it("handles thrown exception", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("network"));
    await triggerStageChangedWorkflows({ organizationId: "org-1", leadId: "l1", toStage: "novo" });
  });
});
