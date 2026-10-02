// @vitest-environment node
/**
 * sendTextToGroupViaInstance — o envio de texto para GRUPO (`…@g.us`), nó
 * `send_to_group`.
 *
 * O que estes testes prendem é o que o PROVIDER e o GOVERNOR recebem:
 *
 *  - o JID chega INTACTO ao `sendText` (nada de normalizeBrazilianPhone, que
 *    trataria os dígitos do grupo como telefone e mandaria para um número
 *    qualquer);
 *  - o governor recebe `recipientPhone: null`, porque o gate frio (P4) procura
 *    inbound daquele destinatário em `channel_messages` e barraria o grupo em
 *    enforce; cap/assinatura/quarentena/categoria seguem valendo;
 *  - provider ≠ uazapi é recusado ANTES de qualquer I/O;
 *  - `sendTextViaInstance` segue igual (telefone normalizado, recipientPhone).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type SendArgs = { number: string; text: string; trackSource?: string; trackId?: string };
type GovernCtx = Record<string, unknown>;

const h = vi.hoisted(() => ({
  sendTextSpy: vi.fn(async (_args: SendArgs) => ({ message_id: "m-1", success: true })),
  providerFactory: vi.fn(),
  governCtxs: [] as GovernCtx[],
  skip: null as null | { action: string; reason: string },
}));

vi.stubGlobal("Deno", {
  env: { get: () => undefined, toObject: () => ({}) },
  serve: () => {},
});

vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: async (...args: unknown[]) => {
    h.providerFactory(...args);
    return { sendText: h.sendTextSpy };
  },
}));

vi.mock("../../supabase/functions/_shared/send-governor/gate.ts", () => ({
  governSend: async (_s: unknown, ctx: GovernCtx, doSend: () => Promise<unknown>) => {
    h.governCtxs.push(ctx);
    if (h.skip) return { __skipped: true, ...h.skip };
    return await doSend();
  },
  isSkippedSend: (r: unknown) => (r as { __skipped?: boolean } | null)?.__skipped === true,
}));

const { sendTextToGroupViaInstance, sendTextViaInstance } = await import(
  "../../supabase/functions/_shared/whatsapp-dispatch.ts"
);

const GRUPO = "120363041234567890@g.us";
const INSTANCIA = {
  id: "inst-1",
  organization_id: "org-A",
  provider: "uazapi",
  instance_name: "torque sdr",
} as unknown as Parameters<typeof sendTextToGroupViaInstance>[1];
const SUPA = {} as Parameters<typeof sendTextToGroupViaInstance>[0];

beforeEach(() => {
  h.sendTextSpy.mockClear().mockResolvedValue({ message_id: "m-1", success: true });
  h.providerFactory.mockClear();
  h.governCtxs.length = 0;
  h.skip = null;
});

describe("sendTextToGroupViaInstance", () => {
  it("entrega o JID intacto ao provider, com trackSource/trackId", async () => {
    const r = await sendTextToGroupViaInstance(SUPA, INSTANCIA, GRUPO, "Oi grupo", {
      trackSource: "workflow-send-to-group",
      trackId: "wf:1",
    });
    expect(r).toEqual({ success: true, messageId: "m-1" });
    expect(h.sendTextSpy).toHaveBeenCalledTimes(1);
    const args = h.sendTextSpy.mock.calls[0][0];
    expect(args.number).toBe(GRUPO);
    expect(args.text).toBe("Oi grupo");
    expect(args.trackSource).toBe("workflow-send-to-group");
    expect(args.trackId).toBe("wf:1");
  });

  it("aceita o formato legado de grupo (criador-timestamp) sem mexer", async () => {
    const legado = "5548999998888-1612345678@g.us";
    await sendTextToGroupViaInstance(SUPA, INSTANCIA, legado, "x");
    expect(h.sendTextSpy.mock.calls[0][0].number).toBe(legado);
  });

  it("governor recebe recipientPhone null (pula o gate frio P4), categoria automation e o conteúdo", async () => {
    await sendTextToGroupViaInstance(SUPA, INSTANCIA, GRUPO, "Oi grupo", {
      trackSource: "workflow-send-to-group",
    });
    expect(h.governCtxs).toHaveLength(1);
    const ctx = h.governCtxs[0];
    expect(ctx.recipientPhone).toBeNull();
    expect(ctx.orgId).toBe("org-A");
    expect(ctx.instanceId).toBe("inst-1");
    expect(ctx.category).toBe("automation");
    expect(ctx.content).toBe("Oi grupo");
  });

  it.each([
    ["telefone", "5548999998888"],
    ["JID de telefone", "5548999998888@s.whatsapp.net"],
    ["injeção de sufixo", `${GRUPO}.evil`],
    ["vazio", ""],
  ])("recusa destino que não é JID de grupo válido (%s) sem I/O", async (_n, dest) => {
    const r = await sendTextToGroupViaInstance(SUPA, INSTANCIA, dest, "x");
    expect(r).toEqual({ success: false, error: "Invalid group JID" });
    expect(h.providerFactory).not.toHaveBeenCalled();
    expect(h.sendTextSpy).not.toHaveBeenCalled();
  });

  it.each(["evolution", "notificame", "meta_cloud"])(
    "recusa provider %s antes de qualquer I/O",
    async (provider) => {
      const r = await sendTextToGroupViaInstance(SUPA, { ...INSTANCIA, provider } as typeof INSTANCIA, GRUPO, "x");
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not supported/i);
      expect(h.providerFactory).not.toHaveBeenCalled();
      expect(h.governCtxs).toHaveLength(0);
    },
  );

  it("governor barrando → falha legível, sem envio", async () => {
    h.skip = { action: "deny", reason: "daily_cap" };
    const r = await sendTextToGroupViaInstance(SUPA, INSTANCIA, GRUPO, "x");
    expect(r).toEqual({ success: false, error: "governor_deny:daily_cap" });
    expect(h.sendTextSpy).not.toHaveBeenCalled();
  });

  it("exceção do provider vira falha com a mensagem, nunca lança", async () => {
    h.sendTextSpy.mockRejectedValueOnce(new Error("Uazapi 500"));
    const r = await sendTextToGroupViaInstance(SUPA, INSTANCIA, GRUPO, "x");
    expect(r).toEqual({ success: false, error: "Uazapi 500" });
  });
});

describe("sendTextViaInstance (regressão do núcleo extraído)", () => {
  it("segue normalizando o telefone e mandando recipientPhone ao governor", async () => {
    const r = await sendTextViaInstance(SUPA, INSTANCIA, "11988887777", "oi", {
      trackSource: "workflow-send-to-number",
    });
    expect(r.success).toBe(true);
    expect(h.sendTextSpy.mock.calls[0][0].number).toBe("5511988887777");
    expect(h.governCtxs[0].recipientPhone).toBe("5511988887777");
  });

  it("segue recusando telefone inválido", async () => {
    const r = await sendTextViaInstance(SUPA, INSTANCIA, "abc", "oi");
    expect(r).toEqual({ success: false, error: "Invalid phone" });
    expect(h.sendTextSpy).not.toHaveBeenCalled();
  });
});
