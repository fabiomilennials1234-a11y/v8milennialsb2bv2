// @vitest-environment node
/**
 * QUEM MARCA O TEMPLATE PARA O GOVERNOR.
 *
 * ─── A METADE QUE O TESTE DO NÚCLEO NÃO ALCANÇA ─────────────────────────────
 *
 * `send-governor-core.test.ts` prova que a P5 ISENTA um envio marcado como
 * template. Isso não prova nada sobre produção: se ninguém marcar, a isenção
 * existe e nunca é usada, e o ciclo fechado volta — com o núcleo verde.
 *
 * ⚠️ E A VOLTA SERIA INVISÍVEL. Apagar `isApprovedTemplate: true` do choke não
 * quebra tipo nenhum (o campo é opcional, e tem de ser: 10 chamadores de
 * `governSend` mandam texto). Não quebra o núcleo. Não quebra o nó. O sintoma
 * seria só o template parando de sair — de novo — na única org em `enforce`.
 *
 * ─── POR QUE NO CHOKE, E POR QUE ISSO IMPORTA AQUI ──────────────────────────
 *
 * A marca vive dentro de `sendTemplateViaInstance`, não nos chamadores. São
 * dois hoje — o nó de workflow e o disparo oficial em massa — e este arquivo
 * exercita a função que os dois atravessam, e não cada um deles. Um terceiro
 * remetente nasce marcado, sem precisar lembrar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../tests/helpers/deno-mock";
import { clearDenoEnv } from "../../tests/helpers/deno-mock";

/** O contexto que o choke entregou ao governor, no envio mais recente. */
const ctxRecebido: Record<string, unknown>[] = [];

vi.mock("../../supabase/functions/_shared/send-governor/gate.ts", () => ({
  // Dublê do choke: registra o contexto e deixa o envio seguir. O veredito da
  // P5 é assunto do núcleo, testado lá com a função real.
  governSend: async (_sb: unknown, ctx: Record<string, unknown>, doSend: () => Promise<unknown>) => {
    ctxRecebido.push(ctx);
    return await doSend();
  },
  isSkippedSend: () => false,
}));

const sendTemplateSpy = vi.fn(async () => ({ success: true, messageId: "hsm-1" }));

vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn(async () => ({ sendTemplate: sendTemplateSpy })),
}));

// Espelhamento é assunto de `mirror-template-media.test.ts`; aqui só não pode
// tentar rede.
vi.mock("../../supabase/functions/_shared/mirror-template-media.ts", () => ({
  espelharMidiaDosComponentes: async (c: unknown[]) => c,
}));

import { sendTemplateViaInstance } from "../../supabase/functions/_shared/whatsapp-dispatch.ts";

const INSTANCIA = {
  id: "inst-oficial",
  organization_id: "org-1",
  provider: "notificame",
  instance_name: "Chiquê",
  status: "connected",
} as never;

const TEMPLATE = {
  name: "confirmacao_responsavel_utilidade_v2",
  language: "pt_BR",
  components: [{ type: "body", parameters: [{ type: "text", text: "Maria" }] }],
  previewText: "Olá Maria",
  buttonLabels: ["Sim", "Não"],
};

beforeEach(() => {
  clearDenoEnv();
  ctxRecebido.length = 0;
  vi.clearAllMocks();
});

describe("o choke de template marca o envio para o governor", () => {
  it("`isApprovedTemplate` chega ao governor como true", async () => {
    const r = await sendTemplateViaInstance(
      {} as never, INSTANCIA, "5511999999999", TEMPLATE,
      { trackSource: "workflow-action-template" },
    );

    expect(r.success).toBe(true);
    expect(ctxRecebido).toHaveLength(1);
    // A asserção que impede o ciclo fechado de voltar.
    expect(ctxRecebido[0].isApprovedTemplate).toBe(true);
  });

  it("marca independente do chamador — o disparo oficial também", async () => {
    await sendTemplateViaInstance(
      {} as never, INSTANCIA, "5511999999999", TEMPLATE,
      { trackSource: "dispatch-router-mass" },
    );

    expect(ctxRecebido[0].isApprovedTemplate).toBe(true);
    // A categoria continua vindo do `trackSource`: a marca isenta da P5, não
    // reclassifica o envio nem o tira das outras regras.
    expect(ctxRecebido[0].category).toBeDefined();
  });

  it("o conteúdo do dedup segue sendo o texto RENDERIZADO", async () => {
    await sendTemplateViaInstance(
      {} as never, INSTANCIA, "5511999999999", TEMPLATE,
      { trackSource: "workflow-action-template" },
    );

    expect(ctxRecebido[0].content).toBe("Olá Maria");
  });
});
