// @vitest-environment node
/**
 * O ESPELHAMENTO NO CAMINHO DA AUTOMAÇÃO (#1706).
 *
 * ─── O DEFEITO QUE ISTO FIXA ────────────────────────────────────────────────
 *
 * A Meta guarda o arquivo do cabeçalho junto do template aprovado e devolve a
 * URL dele na listagem — `https://scontent.whatsapp.net/…&oe=…`. NÓS baixamos
 * com 200; o pipeline de envio da PRÓPRIA META recebe 403 nela:
 *
 *   131053 Media upload error
 *   details: Downloading media from weblink failed with http code 403, Forbidden
 *
 * O caminho do CHAT já espelhava (`whatsapp-api-proxy`). O da AUTOMAÇÃO não —
 * `prepararEnvioDeTemplate` cai em `midiaDeExemploDoCabecalho`, que é exatamente
 * essa URL, e ela viajava crua até a Meta.
 *
 * ⚠️ E A RECUSA CHEGA POR CALLBACK, depois de o executor ter dado o envio por
 * bem-sucedido. Para quem montou o funil a mensagem SOME — sem passo vermelho,
 * sem erro, sem rastro. É por isso que o teste é sobre o que o PROVIDER recebeu,
 * e não sobre o retorno de `sendTemplateViaInstance`: o retorno já era `success`
 * antes do conserto.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CDN_META =
  "https://scontent.whatsapp.net/v/t61.29466-34/684230101_103_n.png?ccb=1-7&oe=6AAD8D57";

const h = vi.hoisted(() => ({
  sendTemplateSpy: vi.fn(async (_args: any) => ({ messageId: "m-1" })),
  fetchSpy: vi.fn(),
  uploads: [] as Array<{ path: string; bytes: number }>,
}));

vi.stubGlobal("Deno", {
  env: { get: () => undefined, toObject: () => ({}) },
  serve: () => {},
});

vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: async () => ({ sendTemplate: h.sendTemplateSpy }),
}));

// O governor não é o assunto aqui: deixa passar e devolve o que o doSend deu.
vi.mock("../../supabase/functions/_shared/send-governor/gate.ts", () => ({
  governSend: async (_s: any, _ctx: any, doSend: () => Promise<any>) => await doSend(),
  isSkippedSend: () => false,
}));

const { sendTemplateViaInstance } = await import(
  "../../supabase/functions/_shared/whatsapp-dispatch.ts"
);

const INSTANCIA = {
  id: "inst-1",
  organization_id: "org-A",
  provider: "notificame",
  instance_name: "oficial",
} as any;

function supabaseFake() {
  return {
    storage: {
      from: () => ({
        upload: async (path: string, data: Uint8Array) => {
          h.uploads.push({ path, bytes: data.byteLength });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://nosso.storage/${path}` },
        }),
      }),
    },
  } as any;
}

/** O que a automação monta hoje para um template de cabeçalho de IMAGEM. */
function componentesComCabecalhoDeMidia(link = CDN_META) {
  return [
    { type: "header", parameters: [{ type: "image", image: { link } }] },
    { type: "body", parameters: [{ type: "text", text: "Filipe" }] },
  ];
}

const enviar = (components: unknown[]) =>
  sendTemplateViaInstance(supabaseFake(), INSTANCIA, "5511988887777", {
    name: "promo_agosto",
    language: "pt_BR",
    components,
    previewText: "Olá Filipe",
    buttonLabels: [],
  });

/** O link que REALMENTE viajou até o provider. */
function linkEnviado(): string {
  const args = h.sendTemplateSpy.mock.calls.at(-1)?.[0] as any;
  const header = (args.components as any[]).find((c) => c.type === "header");
  return header.parameters[0].image.link;
}

beforeEach(() => {
  h.sendTemplateSpy.mockClear();
  h.uploads.length = 0;
  h.fetchSpy.mockReset().mockResolvedValue(
    new Response(new Uint8Array(4096), {
      status: 200,
      headers: { "content-type": "image/png" },
    }),
  );
  vi.stubGlobal("fetch", h.fetchSpy);
});

describe("sendTemplateViaInstance — cabeçalho de mídia (#1706)", () => {
  it("NÃO manda a URL do CDN da Meta — manda a espelhada", async () => {
    const r = await enviar(componentesComCabecalhoDeMidia());

    expect(r.success).toBe(true);
    expect(h.sendTemplateSpy).toHaveBeenCalledTimes(1);

    // A asserção que importa. Antes do conserto o retorno já era `success` e
    // este link era o do CDN — a recusa só apareceria por callback.
    expect(linkEnviado()).not.toContain("scontent.whatsapp.net");
    expect(linkEnviado()).toMatch(/^https:\/\/nosso\.storage\//);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].path).toContain("org-A");
  });

  it("o resto do envelope não é tocado — só o link do cabeçalho muda", async () => {
    await enviar(componentesComCabecalhoDeMidia());

    const args = h.sendTemplateSpy.mock.calls[0][0] as any;
    expect(args.templateName).toBe("promo_agosto");
    expect(args.language).toBe("pt_BR");
    expect(args.previewText).toBe("Olá Filipe");
    expect((args.components as any[]).find((c) => c.type === "body")).toEqual({
      type: "body",
      parameters: [{ type: "text", text: "Filipe" }],
    });
  });

  it("template SEM cabeçalho de mídia não paga nada — nenhum download, nenhum upload", async () => {
    const soTexto = [{ type: "body", parameters: [{ type: "text", text: "Filipe" }] }];
    await enviar(soTexto);

    expect(h.fetchSpy).not.toHaveBeenCalled();
    expect(h.uploads).toHaveLength(0);
    // Mesma referência: o caminho comum não remonta o envelope.
    expect((h.sendTemplateSpy.mock.calls[0][0] as any).components).toBe(soTexto);
  });

  it("mídia que já é do cliente passa intacta — não republicamos arquivo alheio", async () => {
    const doCliente = "https://cliente.com.br/banner.jpg";
    await enviar(componentesComCabecalhoDeMidia(doCliente));

    expect(h.fetchSpy).not.toHaveBeenCalled();
    expect(linkEnviado()).toBe(doCliente);
  });

  it("espelhamento que falha devolve a original — não troca a tentativa por um erro nosso", async () => {
    h.fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    const r = await enviar(componentesComCabecalhoDeMidia());

    expect(r.success).toBe(true);
    expect(linkEnviado()).toBe(CDN_META);
  });
});
