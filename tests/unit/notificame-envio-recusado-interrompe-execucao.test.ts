// @vitest-environment node
/**
 * A RECUSA DA META TEM DE INTERROMPER A EXECUÇÃO QUE ENVIOU O TEMPLATE.
 *
 * O envio de template pelo canal oficial é assíncrono: o POST devolve `queued`,
 * o nó de workflow termina como sucesso e a execução entra em `waiting_response`.
 * A recusa chega segundos depois por callback e só atualizava
 * `channel_messages.status`. Medido na Chique em 14 dias: 433 de 534 templates
 * `failed` — e o lead era movido para `perdido` por "não responder" uma mensagem
 * que nunca saiu.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CHAVE_DE_ORIGEM,
  erroDeEnvioRecusado,
  execucaoDaMetadata,
  origemDoEnvio,
  STATUS_INTERROMPIVEIS,
} from "../../supabase/functions/_shared/envio-recusado.ts";
import { buildOutboundChannelMessageRow } from "../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts";

const EXECUCAO = "1b41f489-5b48-4f0f-9d90-0e69cd5af49c";

describe("origemDoEnvio", () => {
  it("aceita envio de workflow cujo trackId é o id da execução", () => {
    expect(origemDoEnvio("workflow-action-template", EXECUCAO)).toEqual({
      source: "workflow-action-template",
      id: EXECUCAO,
    });
  });

  it("recusa quem não é workflow", () => {
    expect(origemDoEnvio("cobranca", EXECUCAO)).toBeNull();
    expect(origemDoEnvio("blast-official", EXECUCAO)).toBeNull();
  });

  it("recusa trackId que não é uuid (ids de regra, de aviso, de grupo)", () => {
    expect(origemDoEnvio("workflow-send-to-group", "grupo_123")).toBeNull();
    expect(origemDoEnvio("workflow-action-template", "meeting_notify_x_y")).toBeNull();
  });

  it("recusa ausência", () => {
    expect(origemDoEnvio(undefined, EXECUCAO)).toBeNull();
    expect(origemDoEnvio("workflow-action-template", undefined)).toBeNull();
    expect(origemDoEnvio(null, null)).toBeNull();
  });
});

describe("execucaoDaMetadata", () => {
  it("lê a execução do que o provider gravou", () => {
    const row = buildOutboundChannelMessageRow({
      organizationId: "org-1",
      channelKind: "whatsapp",
      instanceId: "inst-1",
      messagingChannelId: null,
      contactExternalId: "555130226364",
      externalId: "ext-1",
      messageType: "template",
      content: "Olá",
      mediaUrl: null,
      timestampIso: "2026-10-26T13:28:09.000Z",
      rawPayload: {},
      botoes: ["SIM", "Não"],
      origem: { source: "workflow-action-template", id: EXECUCAO },
    });

    expect(execucaoDaMetadata(row.metadata)).toBe(EXECUCAO);
    // A marca convive com os botões que a conversa já exibe.
    expect(row.metadata).toMatchObject({ tipo: "template", botoes: ["SIM", "Não"] });
  });

  it("devolve null para mensagem manual ou sem marca", () => {
    expect(execucaoDaMetadata(null)).toBeNull();
    expect(execucaoDaMetadata({ tipo: "template", botoes: ["SIM"] })).toBeNull();
    expect(execucaoDaMetadata([])).toBeNull();
    expect(execucaoDaMetadata({ [CHAVE_DE_ORIGEM]: "texto" })).toBeNull();
  });

  it("não confia em origem forjada: id fora do formato é ignorado", () => {
    expect(
      execucaoDaMetadata({ [CHAVE_DE_ORIGEM]: { source: "workflow-action-template", id: "' or 1=1 --" } }),
    ).toBeNull();
    expect(
      execucaoDaMetadata({ [CHAVE_DE_ORIGEM]: { source: "manual", id: EXECUCAO } }),
    ).toBeNull();
  });
});

describe("linha de saída", () => {
  const base = {
    organizationId: "org-1",
    channelKind: "whatsapp" as const,
    instanceId: "inst-1",
    messagingChannelId: null,
    contactExternalId: "555130226364",
    externalId: "ext-1",
    messageType: "template",
    content: "Olá",
    mediaUrl: null,
    timestampIso: "2026-10-26T13:28:09.000Z",
    rawPayload: {},
  };

  it("sem origem nem botão a metadata continua null", () => {
    expect(buildOutboundChannelMessageRow(base).metadata).toBeNull();
    expect(buildOutboundChannelMessageRow({ ...base, origem: null }).metadata).toBeNull();
  });

  it("origem sem botão grava só a origem — não inventa `tipo: template`", () => {
    const row = buildOutboundChannelMessageRow({
      ...base,
      origem: { source: "workflow-action-template", id: EXECUCAO },
    });
    expect(row.metadata).toEqual({
      [CHAVE_DE_ORIGEM]: { source: "workflow-action-template", id: EXECUCAO },
    });
  });
});

describe("erroDeEnvioRecusado", () => {
  it("leva código e detalhe da Meta crus", () => {
    expect(erroDeEnvioRecusado("131026", "Message undeliverable")).toBe(
      "Envio recusado pela Meta (131026) Message undeliverable",
    );
  });

  it("degrada quando falta código ou detalhe", () => {
    expect(erroDeEnvioRecusado("130472", null)).toBe("Envio recusado pela Meta (130472)");
    expect(erroDeEnvioRecusado(null, "sem motivo")).toBe("Envio recusado pela Meta sem motivo");
    expect(erroDeEnvioRecusado(undefined, "  ")).toBe("Envio recusado pela Meta");
  });
});

describe("STATUS_INTERROMPIVEIS", () => {
  it("não inclui `running`: o executor reescreveria o status e desfaria a falha", () => {
    expect(STATUS_INTERROMPIVEIS).toEqual(["waiting_response", "paused"]);
    expect(STATUS_INTERROMPIVEIS).not.toContain("running" as never);
  });

  it("nunca reabre execução que já terminou", () => {
    for (const terminal of ["completed", "failed", "cancelled"]) {
      expect(STATUS_INTERROMPIVEIS).not.toContain(terminal as never);
    }
  });
});

describe("fiação (estrutural)", () => {
  const raiz = path.resolve(__dirname, "../../supabase/functions");
  const ler = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

  it("o dispatch repassa a origem ao provider de template", () => {
    const fonte = ler("_shared/whatsapp-dispatch.ts");
    const trecho = fonte.slice(fonte.indexOf("export async function sendTemplateViaInstance"));
    const chamada = trecho.slice(0, trecho.indexOf("export async function sendAudioViaInstance"));
    expect(chamada).toMatch(/trackSource:\s*opts\.trackSource/);
    expect(chamada).toMatch(/trackId:\s*opts\.trackId/);
  });

  it("o provider grava a origem no envio de template", () => {
    const fonte = ler("_shared/whatsapp-providers/notificame-provider.ts");
    expect(fonte).toMatch(/origem:\s*origemDoEnvio\(opts\.trackSource,\s*opts\.trackId\)/);
  });

  it("o webhook só interrompe na TRANSIÇÃO para failed, e filtra por org e status", () => {
    const fonte = ler("notificame-webhook/index.ts");
    expect(fonte).toMatch(/resultado\.progride && st\.status === "failed"/);
    expect(fonte).toMatch(/r\.progride && ev\.status === "failed"/);
    expect(fonte).toMatch(/\.in\("status", \[\.\.\.STATUS_INTERROMPIVEIS\]\)/);
    expect(fonte).toMatch(/\.eq\("organization_id", organizationId\)\s*\n\s*\.in\("status"/);
  });
});
