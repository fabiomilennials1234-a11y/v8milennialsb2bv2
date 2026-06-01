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
  normalizeBrazilianPhone: vi.fn((p: string) => p.startsWith("55") ? p : "55" + p),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

import {
  executeTransferHumanWhatsappNotify,
  buildHandoffNotifyMessage,
} from "../../supabase/functions/_shared/actions/transfer-human-whatsapp-notify.ts";

const BASE_PARAMS = {
  lead_id: "lead-1",
  summary: "Cliente pediu cotação de 500 unidades do produto X. Mencionou urgência.",
  priority: "ALTA",
  priority_reason: "Pedido estimado R$15k",
  notify_phones: ["5511999999999", "5511888888888"],
  reason: "Lead pediu falar com humano para negociar prazo",
  extra_notes: "Cliente tem budget aprovado",
};

const LEAD = {
  id: "lead-1",
  name: "João Silva",
  company: "Empresa ABC",
  phone: "5511977777777",
};

describe("buildHandoffNotifyMessage", () => {
  it("formats template with all fields", () => {
    const msg = buildHandoffNotifyMessage({
      leadName: "João Silva",
      leadCompany: "Empresa ABC",
      leadPhone: "5511977777777",
      priority: "ALTA",
      priorityReason: "Pedido estimado R$15k",
      summary: "Cliente pediu cotação de 500 unidades.",
      reason: "Lead pediu falar com humano.",
      extraNotes: "Budget aprovado.",
    });

    expect(msg).toContain("🚨 *Transferência de Lead*");
    expect(msg).toContain("*Lead:* João Silva — Empresa ABC");
    expect(msg).toContain("*Telefone:* 5511977777777");
    expect(msg).toContain("*Prioridade:* ALTA — Pedido estimado R$15k");
    expect(msg).toContain("Cliente pediu cotação de 500 unidades.");
    expect(msg).toContain("Lead pediu falar com humano.");
    expect(msg).toContain("Budget aprovado.");
    expect(msg).toContain("👉 Acesse o sistema para atender.");
  });

  it("omits company when not provided", () => {
    const msg = buildHandoffNotifyMessage({
      leadName: "João Silva",
      leadCompany: null,
      leadPhone: "5511977777777",
      priority: "NORMAL",
      priorityReason: "",
      summary: "Resumo.",
      reason: "Motivo.",
      extraNotes: null,
    });

    expect(msg).toContain("*Lead:* João Silva");
    expect(msg).not.toContain("—");
    expect(msg).toContain("*Prioridade:* NORMAL");
    expect(msg).not.toContain("Budget");
  });

  it("omits extra notes when null", () => {
    const msg = buildHandoffNotifyMessage({
      leadName: "Test",
      leadCompany: null,
      leadPhone: "5500000000000",
      priority: "MÉDIA",
      priorityReason: "Pedido médio",
      summary: "Resumo.",
      reason: "Motivo.",
      extraNotes: null,
    });

    expect(msg).not.toContain("null");
    expect(msg).toContain("👉 Acesse o sistema para atender.");
  });
});

describe("executeTransferHumanWhatsappNotify", () => {
  it("sends WhatsApp to each phone in notify_phones", async () => {
    const { sb, mockTable, mockRpc } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [{
      id: "inst-1",
      organization_id: "org-1",
      provider: "uazapi",
      instance_name: "test-instance",
    }]);

    const result = await executeTransferHumanWhatsappNotify(
      sb,
      BASE_PARAMS,
      "org-1",
      "lead-1",
    );

    expect(result.success).toBe(true);
    expect(mockSendText).toHaveBeenCalledTimes(2);
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        number: "5511999999999",
        trackSource: "handoff-whatsapp-notify",
      }),
    );
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        number: "5511888888888",
        trackSource: "handoff-whatsapp-notify",
      }),
    );
  });

  it("returns no-op when notify_phones is empty", async () => {
    const { sb } = createMockSupabase();

    const result = await executeTransferHumanWhatsappNotify(
      sb,
      { ...BASE_PARAMS, notify_phones: [] },
      "org-1",
      "lead-1",
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("no phones");
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it("reports partial failure when one phone fails", async () => {
    mockSendText
      .mockResolvedValueOnce({ success: true, messageId: "msg-1" })
      .mockRejectedValueOnce(new Error("timeout"));

    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [{
      id: "inst-1",
      organization_id: "org-1",
      provider: "uazapi",
      instance_name: "test-instance",
    }]);

    const result = await executeTransferHumanWhatsappNotify(
      sb,
      BASE_PARAMS,
      "org-1",
      "lead-1",
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("1/2");
  });

  it("fails when lead not found", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", []);

    const result = await executeTransferHumanWhatsappNotify(
      sb,
      BASE_PARAMS,
      "org-1",
      "lead-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("lead");
  });

  it("fails when no WhatsApp instance found", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", []);

    // Override resolveInstance to return null for this test
    const { resolveInstance } = await import("../../supabase/functions/_shared/whatsapp-dispatch.ts");
    (resolveInstance as any).mockResolvedValueOnce(null);

    const result = await executeTransferHumanWhatsappNotify(
      sb,
      BASE_PARAMS,
      "org-1",
      "lead-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("instance");
  });
});
