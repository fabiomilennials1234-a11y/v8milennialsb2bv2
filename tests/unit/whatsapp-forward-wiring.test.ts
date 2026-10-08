// @vitest-environment node
/**
 * Encaminhar — a fiação entre o proxy e a Uazapi.
 *
 *  1. `forward: true` chega ao corpo de `/send/text` e `/send/media` (é ele que
 *     desenha o rótulo "Encaminhada" no WhatsApp do cliente) e NÃO aparece em
 *     envio comum.
 *  2. Os remetentes governados aceitam categoria explícita: o encaminhar vai ao
 *     governor como `manual`, embora o `trackSource` do composer
 *     (`whatsapp-api-proxy`) seja lido por `deriveCategory` como automação.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { governCalls, providerCalls } = vi.hoisted(() => ({
  governCalls: [] as Array<{ category: string; trackSource?: string }>,
  providerCalls: [] as Array<{ method: string; opts: Record<string, unknown> }>,
}));

vi.mock("../../supabase/functions/_shared/send-governor/gate.ts", () => ({
  governSend: async (_admin: unknown, ctx: { category: string; trackSource?: string }, doSend: () => Promise<unknown>) => {
    governCalls.push(ctx);
    return doSend();
  },
  isSkippedSend: () => false,
}));

vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getWhatsAppProvider: async () => ({
    sendText: async (opts: Record<string, unknown>) => {
      providerCalls.push({ method: "sendText", opts });
      return { message_id: "PROV-1", status: "sent" };
    },
    sendMedia: async (opts: Record<string, unknown>) => {
      providerCalls.push({ method: "sendMedia", opts });
      return { message_id: "PROV-2", status: "sent" };
    },
  }),
}));

import {
  sendMediaViaInstance,
  sendTextViaInstance,
} from "../../supabase/functions/_shared/whatsapp-dispatch.ts";
import { UazapiProvider } from "../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts";

const instance = { id: "chip-1", organization_id: "org-1", provider: "uazapi" } as never;
const forwardOpts = {
  trackSource: "whatsapp-api-proxy",
  trackId: "tm-1",
  category: "manual" as const,
  forward: true,
};

describe("remetentes governados", () => {
  beforeEach(() => {
    governCalls.length = 0;
    providerCalls.length = 0;
  });

  it("texto encaminhado: categoria manual no governor e forward no provider", async () => {
    const out = await sendTextViaInstance({}, instance, "5548999990000", "oi", forwardOpts);
    expect(out.success).toBe(true);
    expect(governCalls[0]).toMatchObject({ category: "manual", trackSource: "whatsapp-api-proxy" });
    expect(providerCalls[0].opts).toMatchObject({ forward: true, trackId: "tm-1" });
  });

  it("mídia encaminhada: idem", async () => {
    await sendMediaViaInstance({}, instance, "5548999990000", { type: "ptt", file: "QUJD" }, forwardOpts);
    expect(governCalls[0].category).toBe("manual");
    expect(providerCalls[0].opts).toMatchObject({ type: "ptt", forward: true });
  });

  it("sem categoria explícita, segue `deriveCategory` — comportamento de antes", async () => {
    await sendTextViaInstance({}, instance, "5548999990000", "oi", { trackSource: "whatsapp-api-proxy" });
    expect(governCalls[0].category).toBe("automation");
    expect(providerCalls[0].opts).not.toHaveProperty("forward");
  });
});

describe("UazapiProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // Um Response novo por chamada: o corpo só pode ser lido uma vez.
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ messageid: "X", messageTimestamp: 1791460000, status: "sent" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function provider() {
    return new UazapiProvider({
      baseUrl: "https://uazapi.test",
      token: "tok",
      adminToken: "admin",
      instanceId: "chip-1",
      organizationId: "org-1",
      supabaseAdmin: {} as never,
    });
  }

  function lastBody(): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls.at(-1)!;
    return JSON.parse(String((init as RequestInit).body));
  }

  it("/send/text leva forward:true só quando pedido", async () => {
    await provider().sendText({ number: "5548999990000", text: "oi", forward: true });
    expect(lastBody()).toMatchObject({ forward: true });
    await provider().sendText({ number: "5548999990000", text: "oi" });
    expect(lastBody()).not.toHaveProperty("forward");
  });

  it("/send/media leva forward:true só quando pedido", async () => {
    await provider().sendMedia({ number: "5548999990000", type: "image", file: "https://x/y.jpg", forward: true });
    expect(lastBody()).toMatchObject({ forward: true, type: "image" });
    await provider().sendMedia({ number: "5548999990000", type: "image", file: "https://x/y.jpg" });
    expect(lastBody()).not.toHaveProperty("forward");
  });
});
