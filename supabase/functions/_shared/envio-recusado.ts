/**
 * envio-recusado — liga a RECUSA da Meta à execução de workflow que mandou.
 *
 * O envio de template pelo canal oficial é assíncrono: o POST devolve `queued`
 * e o nó de workflow segue como sucesso. A recusa (131026 número sem WhatsApp,
 * 131049 qualidade, 130472 experimento…) chega SEGUNDOS depois, por callback, e
 * só atualizava `channel_messages.status`. A execução já estava em
 * `waiting_response` e seguia até o timeout — medido na Chique (14 dias): 433 de
 * 534 templates `failed`, e o lead era movido para `perdido` por "não responder"
 * uma mensagem que nunca saiu.
 *
 * PURO: sem I/O e sem relógio, para ser provado sem handler (ver o teste
 * estrutural). Quem lê e escreve o banco é o webhook.
 */

/** Onde a origem fica em `channel_messages.metadata`. */
export const CHAVE_DE_ORIGEM = "origem";

export interface OrigemDoEnvio {
  source: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A origem que vale gravar: só envio de WORKFLOW cujo `trackId` é o id da
 * execução. Outros chamadores passam ids que não são execução (`meeting_notify_…`,
 * id de regra, id de disparo) — gravá-los faria o webhook procurar uma execução
 * que não existe.
 */
export function origemDoEnvio(
  trackSource: string | undefined | null,
  trackId: string | undefined | null,
): OrigemDoEnvio | null {
  if (!trackSource || !trackId) return null;
  if (!trackSource.startsWith("workflow-")) return null;
  if (!UUID.test(trackId)) return null;
  return { source: trackSource, id: trackId };
}

/** O id da execução que mandou a mensagem, ou `null` se não foi um workflow. */
export function execucaoDaMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const origem = (metadata as Record<string, unknown>)[CHAVE_DE_ORIGEM];
  if (typeof origem !== "object" || origem === null || Array.isArray(origem)) return null;
  const { source, id } = origem as Record<string, unknown>;
  if (typeof source !== "string" || typeof id !== "string") return null;
  return origemDoEnvio(source, id)?.id ?? null;
}

/**
 * O texto que vai para `workflow_executions.error`. Código e detalhe da Meta
 * entram crus: é o que o suporte vai procurar na documentação do fornecedor.
 */
export function erroDeEnvioRecusado(
  providerCode: string | null | undefined,
  detail: string | null | undefined,
): string {
  const codigo = providerCode?.trim();
  const motivo = detail?.trim();
  const partes = [codigo ? `(${codigo})` : null, motivo || null].filter(Boolean);
  return partes.length > 0
    ? `Envio recusado pela Meta ${partes.join(" ")}`
    : "Envio recusado pela Meta";
}

/**
 * As execuções que ainda dependem da mensagem e podem ser interrompidas.
 *
 * `running` fica DE FORA de propósito: o executor reescreve o status ao
 * terminar e desfaria a falha em silêncio. A recusa chega segundos depois do
 * envio; a essa altura uma execução com espera já está em `waiting_response`.
 */
export const STATUS_INTERROMPIVEIS = ["waiting_response", "paused"] as const;
