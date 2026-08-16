// @vitest-environment node
/**
 * O gate de acesso da porta de templates.
 *
 * ⚠️ TEMPLATE É COISA DE WHATSAPP, E CANAL DE WHATSAPP MORA EM
 * `whatsapp_instances` — não em `messaging_channels`, que guarda os canais
 * SOCIAIS (Instagram/Facebook). Medido em prod: `messaging_channels` tem uma
 * linha e é de Instagram; as 139 linhas de WhatsApp estão em
 * `whatsapp_instances`. A primeira versão desta porta leu a tabela errada e
 * jamais teria funcionado.
 *
 * O `instance_id` chega DO CLIENTE. É exatamente o vetor já catalogado neste
 * repo: função com credencial de servidor que recorta por parâmetro do cliente
 * sem CONFERIR o parâmetro. Sem este gate, um membro legítimo da org A lista os
 * templates da org B só passando o uuid da instância dela.
 *
 * A decisão vive aqui, pura, porque no handler ela ficaria atrás de rede e auth
 * e nenhum teste a alcançaria.
 */
import { describe, it, expect } from "vitest";

import {
  resolveTemplateChannel,
  type TemplateInstanceRow,
} from "../../supabase/functions/_shared/notificame-template-access.ts";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const OUTRA_ORG = "9d0367c6-2ae8-40cf-9862-a225a5b19026";

function instancia(over: Partial<TemplateInstanceRow> = {}): TemplateInstanceRow {
  return {
    id: "inst-1",
    organization_id: ORG,
    provider: "notificame",
    provider_config: { channel_id: "ch-123" },
    ...over,
  };
}

describe("resolveTemplateChannel — a instância é desta org?", () => {
  it("aceita instância NotificaMe da própria org e devolve o channel_id do fornecedor", () => {
    const r = resolveTemplateChannel(instancia(), ORG);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.channelId).toBe("ch-123");
  });

  it("recusa instância de OUTRA org", () => {
    const r = resolveTemplateChannel(instancia({ organization_id: OUTRA_ORG }), ORG);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("instância inexistente e instância de outra org dão a MESMA resposta", () => {
    // Distinguir as duas transformaria a porta em oráculo: a org B descobriria,
    // pelo código de erro, que aquele uuid existe em algum lugar.
    const ausente = resolveTemplateChannel(null, ORG);
    const alheia = resolveTemplateChannel(instancia({ organization_id: OUTRA_ORG }), ORG);

    expect(ausente.ok).toBe(false);
    expect(alheia.ok).toBe(false);
    if (!ausente.ok && !alheia.ok) {
      expect(ausente.code).toBe(alheia.code);
      expect(ausente.status).toBe(alheia.status);
    }
  });
});

describe("resolveTemplateChannel — a instância serve para templates?", () => {
  it("recusa instância que não é do NotificaMe", () => {
    const r = resolveTemplateChannel(instancia({ provider: "uazapi" }), ORG);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("channel_not_notificame");
      expect(r.status).toBe(422);
    }
  });

  it("recusa instância sem channel_id — não há o que perguntar ao fornecedor", () => {
    const r = resolveTemplateChannel(instancia({ provider_config: {} }), ORG);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("channel_missing_external_id");
  });

  it("recusa channel_id em branco, não só ausente", () => {
    const r = resolveTemplateChannel(instancia({ provider_config: { channel_id: "   " } }), ORG);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("channel_missing_external_id");
  });

  it("recusa provider_config nulo", () => {
    const r = resolveTemplateChannel(instancia({ provider_config: null }), ORG);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("channel_missing_external_id");
  });

  /**
   * Backstop de isolamento social — espelha o throw de `whatsapp-client`. Canal
   * de Instagram/Facebook mora em `messaging_channels`. Se um escapasse para
   * `whatsapp_instances` (bug de escrita, linha editada à mão), listar
   * "templates" dele pediria ao fornecedor algo que não existe naquele canal.
   */
  it("recusa instância que se declara de canal social", () => {
    const r = resolveTemplateChannel(
      instancia({ provider_config: { channel_id: "ch-1", channel_type: "instagram" } }),
      ORG,
    );

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("templates_not_supported");
      expect(r.status).toBe(422);
    }
  });

  it("aceita quando o tipo declarado é whatsapp (ou o apelido wa)", () => {
    for (const tipo of ["whatsapp", "WhatsApp", "wa"]) {
      const r = resolveTemplateChannel(
        instancia({ provider_config: { channel_id: "ch-1", channel_type: tipo } }),
        ORG,
      );
      expect(r.ok, `tipo ${tipo}`).toBe(true);
    }
  });
});
