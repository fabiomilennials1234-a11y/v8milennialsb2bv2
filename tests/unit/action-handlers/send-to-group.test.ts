// @vitest-environment node
/**
 * send_to_group — manda texto WhatsApp para UM grupo (`…@g.us`) pela instância
 * Uazapi nomeada no nó.
 *
 * Prende o contrato do handler (ordem dos portões, retryable de cada falha, o
 * que vai ao envio e a linha persistida), espelhando send-to-number.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

vi.mock("../../../supabase/functions/_shared/time-variables.ts", () => ({
  getTimeBasedVariables: vi.fn().mockReturnValue({ saudacao: "Bom dia", data: "02/10/2026", hora: "10:00" }),
}));
vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
}));

// Real getPinnedWhatsAppInstance / resolveVariables / getLeadPhone / buildTrackId;
// recipientGate espionado para provar que NUNCA é consultado (grupo não é telefone).
vi.mock("../../../supabase/functions/_shared/action-handlers/whatsapp-helpers.ts", async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  recipientGate: vi.fn(),
}));

vi.mock("../../../supabase/functions/_shared/whatsapp-dispatch.ts", async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  sendTextToGroupViaInstance: vi.fn(),
  sendTextViaInstance: vi.fn(),
}));

vi.mock("../../../supabase/functions/_shared/action-handlers/ai-operations.ts", () => ({
  summarizeConversation: vi.fn(),
}));

vi.mock("../../../supabase/functions/_shared/send-dedup.ts", async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  reserveSendOrSkip: vi.fn(),
}));

import { sendToGroup } from "../../../supabase/functions/_shared/action-handlers/send-to-group";
import { recipientGate } from "../../../supabase/functions/_shared/action-handlers/whatsapp-helpers";
import {
  sendTextToGroupViaInstance,
  sendTextViaInstance,
} from "../../../supabase/functions/_shared/whatsapp-dispatch";
import { summarizeConversation } from "../../../supabase/functions/_shared/action-handlers/ai-operations";
import { reserveSendOrSkip } from "../../../supabase/functions/_shared/send-dedup";

const GRUPO = "120363041234567890@g.us";

const WA_INSTANCE = {
  id: "inst-1",
  instance_name: "torque sdr",
  organization_id: "org-1",
  status: "connected",
  provider: "uazapi",
  session_dead_since: null,
};

const LEAD = {
  id: "lead-1",
  name: "Test Lead",
  phone: "11999887766",
  company: "Acme",
  organization_id: "org-1",
  pipe_whatsapp: "novo",
};

const PARAMS = {
  groupJid: GRUPO,
  groupName: "Time Comercial",
  whatsappInstanceId: "inst-1",
  instanceRoutingPolicy: "fixed",
  messageTemplate: "Lead {{nome}} ({{empresa}}) respondeu!",
  _executionId: "exec-9",
  _nodeId: "node-3",
};

function makeInput(overrides: Partial<{
  params: Record<string, unknown>;
  leadId: string | null;
  instances: Record<string, unknown>[];
}> = {}) {
  const { sb, mockTable, getInserted, getUpsertOpts } = createMockSupabase();
  mockTable("whatsapp_instances", overrides.instances ?? [WA_INSTANCE]);
  mockTable("whatsapp_messages", []);
  mockTable("leads", [LEAD]);
  return {
    input: {
      supabase: sb,
      organizationId: "org-1",
      leadId: overrides.leadId !== undefined ? overrides.leadId : "lead-1",
      conversationId: null,
      params: overrides.params || { ...PARAMS },
      executionContext: {},
    },
    getInserted,
    getUpsertOpts,
  };
}

describe("sendToGroup action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendTextToGroupViaInstance).mockResolvedValue({ success: true, messageId: "m-grp-1" });
    vi.mocked(reserveSendOrSkip).mockResolvedValue({ duplicate: false });
    vi.mocked(summarizeConversation).mockResolvedValue({
      success: true,
      data: { summary: "Lead quente, pediu preço." },
    });
  });

  // ── Portões ────────────────────────────────────────────────────────────────

  it("exige leadId", async () => {
    const { input } = makeInput({ leadId: null });
    const r = await sendToGroup(input);
    expect(r.success).toBe(false);
    expect(r.error).toContain("leadId");
    expect(vi.mocked(sendTextToGroupViaInstance)).not.toHaveBeenCalled();
  });

  it.each([
    ["ausente", undefined],
    ["telefone", "5511988887777"],
    ["JID de telefone", "5511988887777@s.whatsapp.net"],
    ["injeção de sufixo", `${GRUPO}.evil`],
  ])("groupJid %s → retryable:false, sem envio", async (_n, groupJid) => {
    const { input } = makeInput({ params: { ...PARAMS, groupJid } });
    const r = await sendToGroup(input);
    expect(r).toMatchObject({
      success: false,
      retryable: false,
      error: "send_to_group requires a valid groupJid",
    });
    expect(vi.mocked(sendTextToGroupViaInstance)).not.toHaveBeenCalled();
  });

  it("sem whatsappInstanceId → retryable:false, sem envio (nunca escolhe sozinho)", async () => {
    const { input } = makeInput({ params: { ...PARAMS, whatsappInstanceId: "" } });
    const r = await sendToGroup(input);
    expect(r).toMatchObject({
      success: false,
      retryable: false,
      error: "send_to_group requires whatsappInstanceId",
    });
    expect(vi.mocked(sendTextToGroupViaInstance)).not.toHaveBeenCalled();
  });

  it("instância inexistente (mesmo havendo UMA viva na org) → retryable:false, sem trocar de número", async () => {
    const { input } = makeInput({ params: { ...PARAMS, whatsappInstanceId: "sumiu" } });
    const r = await sendToGroup(input);
    expect(r.success).toBe(false);
    expect(r.retryable).toBe(false);
    expect(vi.mocked(sendTextToGroupViaInstance)).not.toHaveBeenCalled();
  });

  it("instância caída → retryable:false, sem envio", async () => {
    const { input } = makeInput({
      instances: [{ ...WA_INSTANCE, status: "close" }],
    });
    const r = await sendToGroup(input);
    expect(r.success).toBe(false);
    expect(r.retryable).toBe(false);
    expect(r.error).toMatch(/desconectado/i);
    expect(vi.mocked(sendTextToGroupViaInstance)).not.toHaveBeenCalled();
  });

  it("instância de outra org → retryable:false, sem envio", async () => {
    const { input } = makeInput({
      instances: [{ ...WA_INSTANCE, organization_id: "org-2" }],
    });
    const r = await sendToGroup(input);
    expect(r.success).toBe(false);
    expect(r.retryable).toBe(false);
    expect(vi.mocked(sendTextToGroupViaInstance)).not.toHaveBeenCalled();
  });

  it.each(["evolution", "notificame", "meta_cloud"])(
    "instância %s → retryable:false, sem envio",
    async (provider) => {
      const { input } = makeInput({ instances: [{ ...WA_INSTANCE, provider }] });
      const r = await sendToGroup(input);
      expect(r.success).toBe(false);
      expect(r.retryable).toBe(false);
      expect(vi.mocked(sendTextToGroupViaInstance)).not.toHaveBeenCalled();
    },
  );

  it("template vazio → retryable:false", async () => {
    const { input } = makeInput({ params: { ...PARAMS, messageTemplate: "" } });
    const r = await sendToGroup(input);
    expect(r).toMatchObject({ success: false, retryable: false, error: "Empty message template" });
    expect(vi.mocked(sendTextToGroupViaInstance)).not.toHaveBeenCalled();
  });

  // ── Envio ──────────────────────────────────────────────────────────────────

  it("resolve variáveis do lead e envia ao JID intacto pela instância nomeada", async () => {
    const { input } = makeInput();
    const r = await sendToGroup(input);

    expect(r.success).toBe(true);
    expect(vi.mocked(sendTextToGroupViaInstance)).toHaveBeenCalledTimes(1);
    const [, inst, jid, text, opts] = vi.mocked(sendTextToGroupViaInstance).mock.calls[0];
    expect((inst as { id: string }).id).toBe("inst-1");
    expect(jid).toBe(GRUPO);
    expect(text).toBe("Lead Test Lead (Acme) respondeu!");
    expect(opts).toEqual({ trackSource: "workflow-send-to-group", trackId: "wf-exec-9-node-3" });
    expect(r.data).toEqual({ group_jid: GRUPO, group_name: "Time Comercial", includedSummary: false });
  });

  it("nunca consulta recipientGate nem o envio por telefone", async () => {
    const { input } = makeInput();
    await sendToGroup(input);
    expect(vi.mocked(recipientGate)).not.toHaveBeenCalled();
    expect(vi.mocked(sendTextViaInstance)).not.toHaveBeenCalled();
  });

  it("reserva o dedup por grupo + lead, source workflow", async () => {
    const { input } = makeInput();
    await sendToGroup(input);
    expect(vi.mocked(reserveSendOrSkip)).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        phone: `${GRUPO}#lead-1`,
        content: "Lead Test Lead (Acme) respondeu!",
        source: "workflow",
      }),
    );
  });

  it("duplicata no dedup → sucesso SEM reenvio e sem linha nova", async () => {
    vi.mocked(reserveSendOrSkip).mockResolvedValue({ duplicate: true });
    const { input, getInserted } = makeInput();
    const r = await sendToGroup(input);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ group_jid: GRUPO, deduplicated: true });
    expect(vi.mocked(sendTextToGroupViaInstance)).not.toHaveBeenCalled();
    expect(getInserted("whatsapp_messages")).toHaveLength(0);
  });

  it("anexa resumo + telefone do lead quando includeConversationSummary", async () => {
    const { input } = makeInput({ params: { ...PARAMS, includeConversationSummary: true } });
    const r = await sendToGroup(input);
    const text = vi.mocked(sendTextToGroupViaInstance).mock.calls[0][3] as string;
    expect(text).toContain("Resumo da conversa:\nLead quente, pediu preço.");
    expect(text).toContain("Telefone do lead: 5511999887766");
    expect(r.data).toMatchObject({ includedSummary: true });
  });

  it("resumo que lança não aborta o envio", async () => {
    vi.mocked(summarizeConversation).mockRejectedValue(new Error("LLM down"));
    const { input } = makeInput({ params: { ...PARAMS, includeConversationSummary: true } });
    const r = await sendToGroup(input);
    expect(r.success).toBe(true);
    const text = vi.mocked(sendTextToGroupViaInstance).mock.calls[0][3] as string;
    expect(text).not.toContain("Resumo da conversa");
    expect(text).toContain("Telefone do lead");
  });

  it("não chama o resumidor com o switch desligado", async () => {
    const { input } = makeInput();
    await sendToGroup(input);
    expect(vi.mocked(summarizeConversation)).not.toHaveBeenCalled();
  });

  // ── Falha de envio: nunca duplicar ────────────────────────────────────────

  it("falha ambígua (5xx/timeout) → retryable:false (pode ter saído)", async () => {
    vi.mocked(sendTextToGroupViaInstance).mockResolvedValue({ success: false, error: "Uazapi 500" });
    const { input, getInserted } = makeInput();
    const r = await sendToGroup(input);
    expect(r.success).toBe(false);
    expect(r.retryable).toBe(false);
    expect(r.error).toContain("Uazapi 500");
    expect(getInserted("whatsapp_messages")).toHaveLength(0);
  });

  it("falha comprovadamente antes do provider (rate limit) → retryable:true", async () => {
    vi.mocked(sendTextToGroupViaInstance).mockResolvedValue({ success: false, error: "rate limit exceeded" });
    const { input } = makeInput();
    const r = await sendToGroup(input);
    expect(r.success).toBe(false);
    expect(r.retryable).toBe(true);
  });

  // ── Persistência (D7) ─────────────────────────────────────────────────────

  it("persiste UMA linha de grupo: is_group, remote_jid=jid, lead_id null, sent_source workflow", async () => {
    const { input, getInserted, getUpsertOpts } = makeInput();
    await sendToGroup(input);
    const rows = getInserted("whatsapp_messages") as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: "org-1",
      instance_id: "inst-1",
      message_id: "m-grp-1",
      remote_jid: GRUPO,
      phone_number: "120363041234567890",
      is_group: true,
      direction: "outgoing",
      message_type: "conversation",
      content: "Lead Test Lead (Acme) respondeu!",
      sent_source: "workflow",
      sent_by_ai: true,
      lead_id: null,
      status: "sent",
    });
    expect(typeof rows[0].timestamp).toBe("string");
    expect(getUpsertOpts("whatsapp_messages")[0]).toMatchObject({
      onConflict: "message_id,instance_id",
      ignoreDuplicates: true,
    });
  });

  it("sem messageId do provider → id sintético wf_<uuid>", async () => {
    vi.mocked(sendTextToGroupViaInstance).mockResolvedValue({ success: true });
    const { input, getInserted } = makeInput();
    await sendToGroup(input);
    const rows = getInserted("whatsapp_messages") as Record<string, unknown>[];
    expect(String(rows[0].message_id)).toMatch(/^wf_/);
  });

  // ── Dedup × retentativa (revisor B1) e × lead (N1) ─────────────────────────
  //
  // `fn_reserve_send` só sobe o hit_count (sem release) e a source workflow
  // barra na 2ª ocorrência em 300s. Este dublê reproduz exatamente isso.
  describe("dedup com hit_count real", () => {
    let hits: Map<string, number>;

    beforeEach(() => {
      hits = new Map();
      vi.mocked(reserveSendOrSkip).mockImplementation(async (args) => {
        const key = `${args.orgId}|${args.phone}|${args.content}|${args.source}`;
        const hit = (hits.get(key) ?? 0) + 1;
        hits.set(key, hit);
        return { duplicate: hit >= 2 };
      });
    });

    it("1ª passada falha retentável → 2ª passada (retry) ENVIA de fato, não vira sucesso falso", async () => {
      vi.mocked(sendTextToGroupViaInstance)
        .mockResolvedValueOnce({ success: false, error: "Circuit breaker open for instance" })
        .mockResolvedValueOnce({ success: true, messageId: "m-retry" });

      const first = await sendToGroup(makeInput({ params: { ...PARAMS, _retryAttempt: 0 } }).input);
      expect(first.success).toBe(false);
      expect(first.retryable).toBe(true);

      // Mesmo conteúdo, mesmo lead, dentro da janela — como o executor reagenda.
      const { input, getInserted } = makeInput({ params: { ...PARAMS, _retryAttempt: 1 } });
      const second = await sendToGroup(input);

      expect(vi.mocked(sendTextToGroupViaInstance)).toHaveBeenCalledTimes(2);
      expect(second.success).toBe(true);
      expect(second.data).not.toHaveProperty("deduplicated");
      expect((getInserted("whatsapp_messages") as Record<string, unknown>[])[0].message_id).toBe("m-retry");
    });

    it("controle positivo: sem marca de retry, a mesma 2ª passada seria suprimida pelo dedup", async () => {
      await sendToGroup(makeInput().input);
      const r = await sendToGroup(makeInput().input);
      expect(r.data).toMatchObject({ deduplicated: true });
      expect(vi.mocked(sendTextToGroupViaInstance)).toHaveBeenCalledTimes(1);
    });

    it("template estático: aviso de OUTRO lead no mesmo grupo não é suprimido", async () => {
      const estatico = { ...PARAMS, messageTemplate: "Novo lead respondeu, alguém assume?" };
      await sendToGroup(makeInput({ params: estatico }).input);

      const outro = makeInput({ params: estatico });
      outro.input.leadId = "lead-2";
      const r = await sendToGroup(outro.input);

      expect(r.data).not.toHaveProperty("deduplicated");
      expect(vi.mocked(sendTextToGroupViaInstance)).toHaveBeenCalledTimes(2);
    });
  });
});
