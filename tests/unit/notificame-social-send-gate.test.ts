// @vitest-environment node
/**
 * O gate de envio pelo canal social.
 *
 * O `messaging_channel_id` e o destinatário chegam DO CLIENTE. É o mesmo vetor
 * que o gate de templates fecha: função com credencial de servidor que recorta
 * por parâmetro do cliente sem conferir o parâmetro. Aqui o dano é maior — não
 * é leitura, é ESCRITA: mandar mensagem pela conta de outro tenant.
 */
import { describe, it, expect } from "vitest";

import {
  resolveSocialSendChannel,
  type SocialChannelRow,
} from "../../supabase/functions/_shared/notificame-social-send.ts";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const OUTRA_ORG = "9d0367c6-2ae8-40cf-9862-a225a5b19026";

function canal(over: Partial<SocialChannelRow> = {}): SocialChannelRow {
  return {
    organization_id: ORG,
    provider: "notificame",
    channel_type: "instagram",
    status: "connected",
    external_channel_id: "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
    ...over,
  };
}

describe("resolveSocialSendChannel — o canal é desta org?", () => {
  it("aceita canal de Instagram conectado da própria org", () => {
    const r = resolveSocialSendChannel(canal(), ORG);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.channelId).toBe("3cff29b0-7c9c-4d10-9001-0d1597f55aaf");
      expect(r.channelKind).toBe("instagram");
    }
  });

  it("recusa canal de OUTRA org", () => {
    const r = resolveSocialSendChannel(canal({ organization_id: OUTRA_ORG }), ORG);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("canal inexistente e canal alheio dão a MESMA resposta", () => {
    const ausente = resolveSocialSendChannel(null, ORG);
    const alheio = resolveSocialSendChannel(canal({ organization_id: OUTRA_ORG }), ORG);

    expect(ausente.ok).toBe(false);
    expect(alheio.ok).toBe(false);
    if (!ausente.ok && !alheio.ok) expect(ausente.code).toBe(alheio.code);
  });
});

describe("resolveSocialSendChannel — o canal serve para enviar?", () => {
  it("recusa canal que não é do NotificaMe", () => {
    const r = resolveSocialSendChannel(canal({ provider: "meta_cloud" }), ORG);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("channel_not_notificame");
  });

  it("recusa canal desconectado — a credencial pode não valer mais", () => {
    const r = resolveSocialSendChannel(canal({ status: "disconnected" }), ORG);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("channel_not_connected");
  });

  it("recusa canal sem id do fornecedor — não há `from` para o envelope", () => {
    const r = resolveSocialSendChannel(canal({ external_channel_id: "  " }), ORG);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("channel_missing_external_id");
  });

  /**
   * WhatsApp NÃO passa por aqui, e a recusa é de MODELO. Número de WhatsApp mora
   * em `whatsapp_instances` e tem toda uma superfície própria — governor de
   * envio, janela, templates, limites por instância. Deixar um canal de WhatsApp
   * entrar por esta porta driblaria tudo isso em silêncio.
   */
  it("recusa WhatsApp — esta porta é só para canal social", () => {
    const r = resolveSocialSendChannel(canal({ channel_type: "whatsapp" }), ORG);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("channel_not_social");
  });

  it("aceita facebook, que é o outro canal social do mesmo contrato", () => {
    const r = resolveSocialSendChannel(canal({ channel_type: "facebook" }), ORG);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.channelKind).toBe("facebook");
  });
});
