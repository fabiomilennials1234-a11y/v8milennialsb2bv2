// @vitest-environment node
/**
 * DE QUAL TABELA A CAIXA LÊ.
 *
 * O seletor decidia por `kind === "instagram"`: instagram lê `channel_messages`,
 * o resto lê `whatsapp_messages`. Isso valia enquanto todo WhatsApp era Uazapi.
 *
 * O canal OFICIAL quebra a regra: é `kind: "whatsapp"` (mora em
 * `whatsapp_instances`, como manda o desenho — dar a ele uma linha em
 * `messaging_channels` o rotularia errado em 13 telas e comeria vaga de canal
 * social), mas o inbound dele grava em `channel_messages`.
 *
 * Medido em produção (2026-08-18): a mensagem entrou correta e ficou INVISÍVEL,
 * porque a caixa existia e lia a tabela errada.
 *
 * O discriminador certo não é o `kind`, é o PROVIDER.
 */
import { describe, it, expect } from "vitest";

import { boxUsesChannelMessages } from "./inbox-box-source";

describe("boxUsesChannelMessages", () => {
  it("Instagram lê channel_messages", () => {
    expect(boxUsesChannelMessages({
      kind: "instagram", id: "c1", name: "Perfil", status: "connected", handle: "@x",
    })).toBe(true);
  });

  it("WhatsApp OFICIAL lê channel_messages — é o caso que faltava", () => {
    expect(boxUsesChannelMessages({
      kind: "whatsapp", id: "i1", name: "Chiquê", status: "connected", provider: "notificame",
    })).toBe(true);
  });

  it("WhatsApp por QR (Uazapi) NÃO muda — segue em whatsapp_messages", () => {
    expect(boxUsesChannelMessages({
      kind: "whatsapp", id: "i2", name: "Vendas", status: "connected", provider: "uazapi",
    })).toBe(false);
  });

  it("WhatsApp legado sem provider declarado NÃO muda", () => {
    // ~30 orgs em produção. A ausência do campo tem de significar exatamente o
    // que significava antes desta mudança.
    expect(boxUsesChannelMessages({
      kind: "whatsapp", id: "i3", name: "Antigo", status: "connected",
    })).toBe(false);
  });

  it("evolution, o provider mais antigo, também não muda", () => {
    expect(boxUsesChannelMessages({
      kind: "whatsapp", id: "i4", name: "Velho", status: "connected", provider: "evolution",
    })).toBe(false);
  });
});
