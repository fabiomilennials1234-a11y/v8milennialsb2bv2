/**
 * message-authorship — de quem é a mensagem enviada.
 *
 * `whatsapp_messages.sent_source` já distingue robô de gente, mas "gente" não
 * tem nome: 70.322 mensagens humanas por semana saem sem dono no banco. Este
 * módulo resolve o Team Member autor de um envio e o grava.
 *
 * Não há backfill — as mensagens já enviadas permanecem anônimas (ADR-0033 §4).
 */

import { classifyMessageSource } from "./message-classifier.ts";

export type SendSource = "manual" | "copilot" | "workflow" | "mass_send";

export interface SendActor {
  /** `team_members.id` do humano que disparou o envio. */
  teamMemberId: string;
}

export interface ResolveAuthorArgs {
  /**
   * Quem disparou o envio. `null` quando não há Team Member na org alvo —
   * Master e Gestor de Portfólio operam de fora do roster do cliente.
   */
  actor: SendActor | null;
  sentSource: SendSource;
}

/**
 * Devolve o `team_members.id` a gravar como autor do envio.
 *
 * Só envio humano tem autor. Copilot, workflow e disparo em massa saem de
 * dentro da sessão de uma pessoa em vários caminhos desta base — atribuir a
 * ela inventaria atendimento que ela não fez, e é exatamente o número que a
 * dimensão `pessoa` do Gargalo vai ler.
 */
export function resolveAuthor(args: ResolveAuthorArgs): string | null {
  if (args.sentSource !== "manual") return null;
  return args.actor?.teamMemberId || null;
}

/**
 * Lê o autor de volta do eco do provedor.
 *
 * A mensagem enviada pela caixa de entrada não é gravada por quem a envia: ela
 * volta pelo webhook, e é lá que a linha nasce. Em vez de casar dois espaços de
 * id depois — que nesta base já resultou em zero coincidências — a autoria
 * VIAJA com a mensagem: o proxy manda o Team Member em `track_id`, o provedor
 * ecoa no payload do webhook, e aqui ela é lida de volta.
 *
 * Só aceita UUID. `track_id` é campo livre que qualquer caminho de envio pode
 * preencher; gravar o que vier faria uma string arbitrária virar autor.
 */
export function readAuthorFromPayload(
  rawPayload: Record<string, unknown> | null | undefined,
  sentSource: SendSource,
): string | null {
  if (sentSource !== "manual") return null;

  const trackId = rawPayload?.track_id;
  if (typeof trackId !== "string" || !UUID.test(trackId)) return null;

  return trackId;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Autoria a partir do payload que o provedor devolve no webhook.
 *
 * Compõe a classificação de origem com a leitura do eco: o mesmo `track_id`
 * vale como autor quando a mensagem saiu da caixa de entrada, e não vale
 * quando saiu de um disparo automático que por acaso preencheu o campo.
 *
 * Entrada não tem autor por definição — o autor é quem ENVIOU.
 */
export function authorFromWebhookEcho(
  rawPayload: Record<string, unknown> | null | undefined,
  direction: "incoming" | "outgoing",
  instanceId: string,
): string | null {
  if (direction !== "outgoing") return null;

  const { sent_source } = classifyMessageSource({
    raw_payload: rawPayload ?? {},
    direction,
    instance_context: { instance_id: instanceId },
  });

  if (sent_source !== "manual") return null;

  return readAuthorFromPayload(rawPayload, "manual");
}
