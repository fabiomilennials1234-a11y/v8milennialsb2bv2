import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const mockSendText = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, messageId: "msg-1" }));

vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn().mockResolvedValue({
    sendText: mockSendText,
  }),
}));

vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  resolveInstance: vi.fn().mockResolvedValue({
    id: "inst-1",
    organization_id: "org-1",
    provider: "uazapi",
    instance_name: "test-instance",
  }),
  normalizeBrazilianPhone: vi.fn((p: string) => (p.startsWith("55") ? p : "55" + p)),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

import {
  executeScheduleMeetingWhatsappNotify,
  buildMeetingNotifyMessage,
} from "../../supabase/functions/_shared/actions/schedule-meeting-whatsapp-notify.ts";

const LEAD = {
  id: "lead-1",
  name: "João Silva",
  company: "Empresa ABC",
  phone: "5511977777777",
};

const CONVERSATION = { id: "conv-1", agent_id: "agent-1" };
const AGENT = {
  id: "agent-1",
  organization_id: "org-1",
  is_active: true,
  handoff_notify_phones: ["5548984334050"],
};

describe("buildMeetingNotifyMessage", () => {
  it("formats template with all fields incl. Meet link", () => {
    const msg = buildMeetingNotifyMessage({
      leadName: "João Silva",
      leadCompany: "Empresa ABC",
      leadPhone: "5511977777777",
      meetingDate: "2026-06-12",
      meetingTime: "14:30",
      meetLink: "https://meet.google.com/abc-defg-hij",
    });

    expect(msg).toContain("📅 *Reunião agendada*");
    expect(msg).toContain("*Lead:* João Silva — Empresa ABC");
    expect(msg).toContain("*Telefone:* 5511977777777");
    expect(msg).toContain("*Data:* 12/06/2026 às 14:30");
    expect(msg).toContain("*Google Meet:* https://meet.google.com/abc-defg-hij");
    expect(msg).toContain("👉 Acesse o sistema para acompanhar.");
  });

  it("omits company when not provided", () => {
    const msg = buildMeetingNotifyMessage({
      leadName: "João Silva",
      leadCompany: null,
      leadPhone: "5511977777777",
      meetingDate: "2026-06-12",
      meetingTime: "09:00",
      meetLink: null,
    });

    expect(msg).toContain("*Lead:* João Silva");
    expect(msg).not.toContain("—");
  });

  it("omits Meet line when no link", () => {
    const msg = buildMeetingNotifyMessage({
      leadName: "Test",
      leadCompany: null,
      leadPhone: "5500000000000",
      meetingDate: "2026-01-05",
      meetingTime: "09:00",
      meetLink: null,
    });

    expect(msg).not.toContain("Google Meet");
    expect(msg).toContain("*Data:* 05/01/2026 às 09:00");
  });

  it("leaves malformed date untouched", () => {
    const msg = buildMeetingNotifyMessage({
      leadName: "Test",
      leadCompany: null,
      leadPhone: "5500000000000",
      meetingDate: "amanhã",
      meetingTime: "09:00",
      meetLink: null,
    });
    expect(msg).toContain("*Data:* amanhã às 09:00");
  });
});

describe("executeScheduleMeetingWhatsappNotify", () => {
  it("resolves phones from conversation agent and sends", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("conversations", [CONVERSATION]);
    mockTable("copilot_agents", [AGENT]);
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [{
      id: "inst-1",
      organization_id: "org-1",
      provider: "uazapi",
      instance_name: "test-instance",
    }]);

    const result = await executeScheduleMeetingWhatsappNotify(
      sb,
      { lead_id: "lead-1", meeting_date: "2026-06-12", meeting_time: "14:30" },
      "org-1",
      "lead-1",
      "conv-1",
    );

    expect(result.success).toBe(true);
    expect(mockSendText).toHaveBeenCalledTimes(1);
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        number: "5548984334050",
        trackSource: "schedule-meeting-whatsapp-notify",
      }),
    );
  });

  it("no-ops when agent has no notify phones", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("conversations", [CONVERSATION]);
    mockTable("copilot_agents", [{ ...AGENT, handoff_notify_phones: [] }]);

    const result = await executeScheduleMeetingWhatsappNotify(
      sb,
      { lead_id: "lead-1", meeting_date: "2026-06-12", meeting_time: "14:30" },
      "org-1",
      "lead-1",
      "conv-1",
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("no notify phones");
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it("fails when lead_id missing", async () => {
    const { sb } = createMockSupabase();
    const result = await executeScheduleMeetingWhatsappNotify(
      sb,
      { meeting_date: "2026-06-12" },
      "org-1",
      null,
      "conv-1",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("lead_id");
  });
});
