import { describe, it, expect, vi, beforeEach } from "vitest";
import "../helpers/deno-mock";

const fireTriggerSpy = vi.fn(async () => 1);

vi.mock("../../supabase/functions/_shared/workflow-trigger.ts", () => ({
  fireTrigger: (...args: unknown[]) => fireTriggerSpy(...(args as [])),
}));

import { handleLeadStageChanged } from "../../supabase/functions/_shared/events/handlers/lead-stage-changed";
import type { LeadStageChangedEvent } from "../../supabase/functions/_shared/events/types";

describe("handleLeadStageChanged", () => {
  beforeEach(() => {
    fireTriggerSpy.mockClear();
  });

  it("delega para fireTrigger com triggerType stage_changed e context completo", async () => {
    const event: LeadStageChangedEvent = {
      event_type: "lead.stage_changed",
      aggregate_type: "pipeline_entry",
      aggregate_id: "pe-1",
      organization_id: "org-1",
      payload: {
        lead_id: "lead-1",
        pipeline_id: "pl-1",
        campaign_id: null,
        pipe_type: "whatsapp",
        old_stage_key: "novo",
        new_stage_key: "abordado",
        pipeline_slug: "whatsapp",
      },
    };

    const supabase = {} as never;
    await handleLeadStageChanged(supabase, event);

    expect(fireTriggerSpy).toHaveBeenCalledTimes(1);
    const call = fireTriggerSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      organizationId: "org-1",
      triggerType: "stage_changed",
      leadId: "lead-1",
      source: "event-bus",
    });
    expect(call.context).toMatchObject({
      pipe_type: "whatsapp",
      pipeline_id: "pl-1",
      campanha_id: null,
      from_stage: "novo",
      to_stage: "abordado",
    });
  });

  it("propaga campaign_id como campanha_id no context (aggregate campanha_lead)", async () => {
    const event: LeadStageChangedEvent = {
      event_type: "lead.stage_changed",
      aggregate_type: "campanha_lead",
      aggregate_id: "cl-1",
      organization_id: "org-2",
      payload: {
        lead_id: "lead-2",
        pipeline_id: null,
        campaign_id: "camp-9",
        pipe_type: null,
        old_stage_key: null,
        new_stage_key: "qualificado",
        pipeline_slug: null,
      },
    };

    await handleLeadStageChanged({} as never, event);

    const call = fireTriggerSpy.mock.calls[0][0] as { context: Record<string, unknown> };
    expect(call.context.campanha_id).toBe("camp-9");
    expect(call.context.to_stage).toBe("qualificado");
  });
});
