/**
 * Reconciliação de envio de TEXTO com desfecho ambíguo (timeout / 5xx do Uazapi).
 *
 * O Uazapi responde timeout/500 para entregas que de fato aceitou (ver
 * `uazapi-client.ts`, `isReplaySafe`). No chat isso virava "Falha no envio"
 * numa mensagem que o cliente JÁ recebeu: o proxy devolvia erro, não gravava
 * linha, e o polling de confirmação do front nunca achava nada.
 *
 * Aqui o proxy PERGUNTA ao Uazapi o que aconteceu, antes de devolver erro:
 * busca no chat uma mensagem outgoing recente com o mesmo texto. Achou =
 * sucesso. Não achou = desfecho DESCONHECIDO (`send_outcome_unknown`), nunca
 * "falhou": quem decide reenviar é o humano. NUNCA reenvia sozinho.
 *
 * Funções puras com dependências injetadas, para testar sem rede.
 */

export const SEND_OUTCOME_UNKNOWN = "send_outcome_unknown";

/** Origem gravada pelo proxy nos envios do composer (ver `trackSource` no proxy). */
const PROXY_TRACK_SOURCE = "whatsapp-api-proxy";

/** Margem p/ relógio do Uazapi vs. o nosso: aceita mensagens até 5 s ANTES do envio. */
const CLOCK_SKEW_MS = 5_000;
/** Teto de tempo desde o início do envio: nada além do orçamento do proxy. */
const MAX_AGE_MS = 2 * 60_000;
export const RECONCILE_FIND_LIMIT = 20;

export interface RecentOutgoing {
  messageId: string;
  text: string;
  timestampMs: number;
}

/**
 * Falha que PODE ter entregue: timeout ou 5xx. Circuit breaker aberto é
 * recusa antes do envio (nada saiu); 4xx idem.
 */
export function isAmbiguousSendFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { status?: unknown; provider_code?: unknown };
  if (e.provider_code === "circuit_breaker_open") return false;
  if (e.provider_code === "timeout") return true;
  return typeof e.status === "number" && e.status >= 500;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function textOf(row: Record<string, unknown>): string | null {
  if (typeof row.text === "string") return row.text;
  if (typeof row.content === "string") return row.content;
  const content = row.content;
  if (content && typeof content === "object" && typeof (content as Record<string, unknown>).text === "string") {
    return (content as Record<string, string>).text;
  }
  return null;
}

/** Extrai, do payload cru do `/message/find`, as outgoing de texto utilizáveis. */
export function parseRecentOutgoing(rows: unknown[]): RecentOutgoing[] {
  const out: RecentOutgoing[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const fromMe = row.fromMe === true || row.fromme === true || row.wa_fromMe === true;
    if (!fromMe) continue;
    // Mesma preferência de id do resultado de envio (`normalizeUazapiMessageResult`).
    const id = row.id ?? row.messageid;
    const text = textOf(row);
    const ts = Number(row.messageTimestamp ?? row.timestamp);
    if (typeof id !== "string" || !id.trim() || text === null || !Number.isFinite(ts) || ts <= 0) continue;
    // Envio de outra origem (automação, copilot) com o mesmo texto não é este envio.
    if (typeof row.track_source === "string" && row.track_source && row.track_source !== PROXY_TRACK_SOURCE) continue;
    const status = typeof row.status === "string" ? row.status.toLowerCase() : "";
    if (["failed", "error", "canceled", "cancelled"].includes(status)) continue;
    out.push({ messageId: id, text, timestampMs: ts >= 1e12 ? ts : ts * 1000 });
  }
  return out;
}

export function pickReconciledMessage(
  candidates: RecentOutgoing[],
  text: string,
  sentAtMs: number,
  knownIds: ReadonlySet<string>,
  nowMs: number,
): RecentOutgoing | null {
  const wanted = normalizeText(text);
  const matches = candidates.filter((c) =>
    normalizeText(c.text) === wanted &&
    !knownIds.has(c.messageId) &&
    c.timestampMs >= sentAtMs - CLOCK_SKEW_MS &&
    c.timestampMs <= nowMs + CLOCK_SKEW_MS &&
    nowMs - c.timestampMs <= MAX_AGE_MS
  );
  if (!matches.length) return null;
  // Mais antiga: é a que o nosso POST produziu; uma posterior seria outro envio.
  return matches.reduce((a, b) => (b.timestampMs < a.timestampMs ? b : a));
}

export interface ReconcileDeps {
  /** Linhas cruas de `/message/find`. Pode lançar: erro conta como "não achou". */
  findRecent: () => Promise<unknown[]>;
  /** Dos ids candidatos, quais JÁ existem em `whatsapp_messages` (envios anteriores). */
  existingIds: (ids: string[]) => Promise<ReadonlySet<string>>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface ReconcileOptions {
  text: string;
  sentAtMs: number;
  attempts?: number;
  firstDelayMs?: number;
  spacingMs?: number;
}

export interface ReconcileOutcome {
  found: RecentOutgoing | null;
  attempts: number;
}

/**
 * Até `attempts` consultas (padrão 2) espaçadas. Pior caso: 2 s + 5 s + 3 s + 5 s
 * = 15 s depois do timeout de 15 s do Uazapi, ~30 s no total — bem abaixo do
 * limite da edge function, e dentro da janela de polling do cliente (~45 s).
 */
export async function reconcileAmbiguousSend(
  deps: ReconcileDeps,
  opts: ReconcileOptions,
): Promise<ReconcileOutcome> {
  const attempts = opts.attempts ?? 2;
  const first = opts.firstDelayMs ?? 2_000;
  const spacing = opts.spacingMs ?? 3_000;
  let made = 0;
  for (let i = 0; i < attempts; i++) {
    await deps.sleep(i === 0 ? first : spacing);
    made += 1;
    try {
      const candidates = parseRecentOutgoing(await deps.findRecent());
      if (!candidates.length) continue;
      const known = await deps.existingIds(candidates.map((c) => c.messageId));
      const hit = pickReconciledMessage(candidates, opts.text, opts.sentAtMs, known, deps.now());
      if (hit) return { found: hit, attempts: made };
    } catch {
      // Consulta falhou: continua desconhecido. Nunca vira "falhou".
    }
  }
  return { found: null, attempts: made };
}
