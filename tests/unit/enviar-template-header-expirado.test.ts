// @vitest-environment node
/**
 * Template com link de cabeçalho expirado NÃO é retentado.
 *
 * O executor retenta por padrão quando `retryable` falta. Retentar um link de
 * cabeçalho que a Meta não baixa mais só repete a falha até alguém reabrir o nó
 * e escolher o template de novo — e cada tentativa gasta um download.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enviar: vi.fn(),
}));

vi.stubGlobal("Deno", { env: { get: () => undefined, toObject: () => ({}) }, serve: () => {} });

vi.mock("../../supabase/functions/_shared/action-handlers/whatsapp-helpers.ts", () => ({
  resolveVariables: async (_s: unknown, _l: string, t: string) => t,
}));
vi.mock("../../supabase/functions/_shared/template-node-valores.ts", () => ({
  prepararEnvioDeTemplate: async () => ({
    ok: true,
    components: [],
    previewText: "Olá",
    buttonLabels: [],
  }),
}));
vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  sendTemplateViaInstance: h.enviar,
}));

const { enviarTemplateAprovado } = await import(
  "../../supabase/functions/_shared/action-handlers/enviar-template.ts"
);

const chamar = () =>
  enviarTemplateAprovado({
    supabase: {} as never,
    leadId: "lead-1",
    instance: {},
    phone: "5511988887777",
    template: { name: "promo", language: "pt_BR", components: [], variables: {} } as never,
    trackSource: "workflow",
  });

describe("enviarTemplateAprovado — cabeçalho de mídia inacessível", () => {
  it("🔑 header_media_unreachable volta com retryable:false", async () => {
    h.enviar.mockResolvedValue({
      success: false,
      error: "header_media_unreachable: a imagem do cabeçalho do template (scontent.whatsapp.net) expirou",
    });
    const r = await chamar();
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect((r as { erro: string }).erro).toContain("header_media_unreachable");
  });

  it("outra falha de envio NÃO ganha retryable — o executor decide como sempre", async () => {
    h.enviar.mockResolvedValue({ success: false, error: "Uazapi server error 500" });
    const r = await chamar();
    expect(r).toMatchObject({ ok: false });
    expect(r).not.toHaveProperty("retryable");
  });

  it("envio bem-sucedido não muda", async () => {
    h.enviar.mockResolvedValue({ success: true });
    expect(await chamar()).toEqual({ ok: true, nome: "promo" });
  });
});
