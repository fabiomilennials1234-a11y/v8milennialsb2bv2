/**
 * O nó de mensagem no Instagram — issue #1691.
 *
 * ─── O QUE ESTE ARQUIVO PROVA ───────────────────────────────────────────────
 *
 * O seam é a interface do módulo — `executeWorkflowAction` —, e não as funções
 * por dentro dele: é assim que `workflow-action-audio.test.ts` fixou a regressão
 * do áudio, e pelo mesmo motivo. Os buracos ficam ENTRE as peças.
 *
 * ─── O DEFEITO QUE ELE FECHA ────────────────────────────────────────────────
 *
 * `send_meta_message` estava MORTO — 0 nós configurados e 0 execuções em 30
 * dias — e não por falta de demanda: o handler mandava `{ lead_id, message }`
 * para uma função que exige `recipientId` e um JWT de USUÁRIO. Um executor de
 * workflow não tem usuário. O envio nunca podia ter dado certo.
 *
 * ─── O CASO QUE MERECE EXISTIR MESMO ESTANDO VAZIO HOJE ─────────────────────
 *
 * Medido: 562 mensagens de Instagram recebidas em produção, ZERO com lead
 * vinculado. Enquanto ninguém vincular, este nó fica ocioso — e o teste "lead
 * sem conversa vinculada" é o que fixa que ocioso NÃO é erro: o nó não age, e a
 * execução segue em vez de parar por causa de uma caixa que ninguém ligou.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../tests/helpers/deno-mock";
import { clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const sendTextMock = vi.fn();
const sendMediaMock = vi.fn();
const construidoCom: Array<Record<string, unknown>> = [];

// O provider é o dublê: ele é quem fala com o fornecedor e quem grava a linha de
// saída. O que este arquivo mede é O QUE CHEGA ATÉ ELE — endereço, canal e
// conteúdo —, porque é aí que o nó antigo errava.
vi.mock("../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts", () => ({
  NotificameProvider: class {
    sendText = sendTextMock;
    sendMedia = sendMediaMock;
    constructor(opts: Record<string, unknown>) {
      construidoCom.push(opts);
    }
  },
}));

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  construidoCom.length = 0;
  sendTextMock.mockResolvedValue({ message_id: "ig-msg-1", status: "sent", timestamp: 1 });
  sendMediaMock.mockResolvedValue({ message_id: "ig-msg-2", status: "sent", timestamp: 1 });
});

import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";

const ORG = "org-1";
const LEAD = "lead-1";
const CANAL = "canal-ig-1";
const IGSID = "igsid-cliente-777";

const LEAD_ROW = {
  id: LEAD,
  name: "Fulana",
  company: "Acme",
  organization_id: ORG,
  pipe_whatsapp: "novo",
  rating: 5,
};

const CANAL_ROW = {
  id: CANAL,
  organization_id: ORG,
  provider: "notificame",
  channel_type: "instagram",
  status: "connected",
  external_channel_id: "ch_ig_da_org",
  subaccount_id: "sub-1",
};

const VINCULO = {
  id: "vinc-1",
  organization_id: ORG,
  lead_id: LEAD,
  channel_type: "instagram",
  external_user_id: IGSID,
  messaging_channel_id: CANAL,
  linked_at: "2026-08-19T10:00:00Z",
};

function cenario(over: {
  vinculos?: Record<string, unknown>[];
  canais?: Record<string, unknown>[];
} = {}) {
  const { sb, mockTable, getInserted } = createMockSupabase();
  mockTable("leads", [LEAD_ROW]);
  mockTable("lead_history", []);
  mockTable("channel_messages", []);
  mockTable("lead_social_identities", over.vinculos ?? [VINCULO]);
  mockTable("messaging_channels", over.canais ?? [CANAL_ROW]);
  return { sb, getInserted };
}

const rodar = (sb: unknown, nodeData: Record<string, unknown>) =>
  executeWorkflowAction({
    supabase: sb as never,
    organizationId: ORG,
    leadId: LEAD,
    nodeData: { actionType: "send_meta_message", ...nodeData },
    executionContext: {},
  });

describe("o nó manda no Direct de uma conversa vinculada", () => {
  it("texto, endereçado pelo IGSID do vínculo e pelo canal da org", async () => {
    const { sb } = cenario();

    const r = await rodar(sb, { metaMessage: "Olá {{nome}}!" });

    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
    expect(sendTextMock).toHaveBeenCalledTimes(1);

    const enviado = sendTextMock.mock.calls[0][0];
    // ⚠️ O ENDEREÇO É O IGSID, não um telefone. Lá não existe telefone, e é por
    // isso que o nó endereça por LEAD: o vínculo é que sabe para quem falar.
    expect(enviado.number).toBe(IGSID);
    // A mesma linguagem de variáveis dos nós de texto do WhatsApp.
    expect(enviado.text).toBe("Olá Fulana!");

    // E pela caixa certa: o canal do fornecedor, não o uuid da nossa linha.
    expect(construidoCom[0].channelId).toBe("ch_ig_da_org");
    expect(construidoCom[0].channelKind).toBe("instagram");
    expect(construidoCom[0].messagingChannelId).toBe(CANAL);
  });

  it("imagem, vídeo e áudio, com a legenda resolvida", async () => {
    for (const [naTela, noProvider] of [
      ["imagem", "image"],
      ["video", "video"],
      ["audio", "audio"],
    ]) {
      vi.clearAllMocks();
      sendMediaMock.mockResolvedValue({ message_id: "m", status: "sent", timestamp: 1 });
      const { sb } = cenario();

      const r = await rodar(sb, {
        metaMessageType: naTela,
        metaMediaUrl: "https://cdn.exemplo.com/arquivo.bin",
        metaCaption: "Oi {{nome}}",
      });

      expect(r.success, `${naTela} deveria enviar`).toBe(true);
      const enviado = sendMediaMock.mock.calls[0][0];
      expect(enviado.type).toBe(noProvider);
      expect(enviado.number).toBe(IGSID);
      expect(enviado.file).toBe("https://cdn.exemplo.com/arquivo.bin");
      expect(enviado.caption).toBe("Oi Fulana");
    }
  });

  it("NÃO grava a linha de saída — quem grava é o provider", async () => {
    // Gravar aqui também duplicaria a mensagem na tela do vendedor: o provider
    // já persiste em `channel_messages` com upsert por (external_id, channel, org).
    const { sb, getInserted } = cenario();

    await rodar(sb, { metaMessage: "oi" });

    expect(getInserted("channel_messages")).toHaveLength(0);
  });
});

describe("conversa sem lead vinculado", () => {
  it("o nó NÃO age, e isso não é erro — a execução segue", async () => {
    // O estado das 562 mensagens medidas em produção. Um lead que nunca escreveu
    // no Direct simplesmente não tem endereço lá; tratar isso como falha pararia
    // a execução inteira por causa de um canal que a org talvez nem use.
    const { sb } = cenario({ vinculos: [] });

    const r = await rodar(sb, { metaMessage: "oi" });

    expect(sendTextMock).not.toHaveBeenCalled();
    expect(sendMediaMock).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.data).toMatchObject({ skipped: true });
  });

  it("o vínculo de OUTRO lead não serve de endereço", async () => {
    const { sb } = cenario({
      vinculos: [{ ...VINCULO, id: "vinc-2", lead_id: "lead-outro" }],
    });

    const r = await rodar(sb, { metaMessage: "oi" });

    expect(sendTextMock).not.toHaveBeenCalled();
    expect(r.data).toMatchObject({ skipped: true });
  });
});

describe("o que faz o nó falhar e a execução parar", () => {
  // ⚠️ Das 1.749 ligações entre nós dos workflows ativos, ZERO são de saída de
  // erro. Um nó que falha derruba a execução — e é o comportamento escolhido.

  it("a recusa do fornecedor sobe legível, sem retentativa", async () => {
    sendTextMock.mockRejectedValue(new Error("fora da janela de mensagens"));
    const { sb } = cenario();

    const r = await rodar(sb, { metaMessage: "oi" });

    expect(r.success).toBe(false);
    expect(r.error).toContain("fora da janela de mensagens");
    expect(r.retryable).not.toBe(true);
  });

  it("documento e figurinha são recusados com motivo, não em silêncio", async () => {
    for (const tipo of ["documento", "figurinha"]) {
      vi.clearAllMocks();
      const { sb } = cenario();

      const r = await rodar(sb, {
        metaMessageType: tipo,
        metaMediaUrl: "https://cdn.exemplo.com/a.pdf",
      });

      expect(r.success).toBe(false);
      expect(r.error).toBeTruthy();
      expect(sendMediaMock).not.toHaveBeenCalled();
    }
  });

  it("canal de OUTRA organização não envia — o vínculo não autoriza a caixa", async () => {
    // Aqui o gate é ESCRITA: um canal alheio aceito manda mensagem, com a marca
    // do cliente, pela conta de outro tenant.
    const { sb } = cenario({
      canais: [{ ...CANAL_ROW, organization_id: "org-alheia" }],
    });

    const r = await rodar(sb, { metaMessage: "oi" });

    expect(r.success).toBe(false);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("dois canais de Instagram conectados e nenhuma indicação: falha FECHADO", async () => {
    // Escolher "o primeiro" mandaria a mensagem pela identidade errada da
    // empresa. A máquina nunca escolhe sozinha — o invariante do ADR-0025.
    const { sb } = cenario({
      vinculos: [{ ...VINCULO, messaging_channel_id: null }],
      canais: [
        CANAL_ROW,
        { ...CANAL_ROW, id: "canal-ig-2", external_channel_id: "ch_ig_2" },
      ],
    });

    const r = await rodar(sb, { metaMessage: "oi" });

    expect(r.success).toBe(false);
    expect(r.data).toMatchObject({ code: "instagram_channel_ambiguous" });
    expect(sendTextMock).not.toHaveBeenCalled();
  });
});

describe("a rota da Meta direta deixa de ser usada", () => {
  it("o nó não chama mais a edge function antiga", async () => {
    // O destino antigo exigia `recipientId` e JWT de usuário — nenhum dos dois
    // existe num executor de workflow. Enquanto ele fosse o destino, o nó não
    // tinha como funcionar.
    const fetchSpy = vi.fn();
    const anterior = globalThis.fetch;
    globalThis.fetch = fetchSpy as never;
    try {
      const { sb } = cenario();
      await rodar(sb, { metaMessage: "oi" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = anterior;
    }
  });
});
