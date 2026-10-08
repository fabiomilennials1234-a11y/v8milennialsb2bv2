/**
 * Encaminhar mensagem (v1) — regras puras da ação `forwardMessage` do
 * whatsapp-api-proxy.
 *
 * Por que o teto e o ritmo moram aqui e não no send governor: o governor isenta
 * a categoria `manual` em todos os modos (send-governor/core.ts, regra 1), então
 * passar por ele NÃO espaça nem limita envio manual. Sem teto e sem pausa, um
 * "encaminhar" vira envio em massa por um caminho sem trava — a classe de risco
 * que queimou o chip da Bennedita (463). O teto vale no servidor; o limite da UI
 * é só conveniência.
 *
 * Tudo aqui é determinístico e testável sem rede: o envio e o relógio entram
 * por parâmetro.
 */

/** Destinos por pedido. Acima disso o pedido inteiro é recusado, nunca truncado. */
export const FORWARD_MAX_TARGETS = 5;
/** Pausa (jitter) entre um destino e o seguinte. */
export const FORWARD_GAP_MIN_MS = 2000;
export const FORWARD_GAP_MAX_MS = 4500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ForwardParseError = "invalid_request" | "no_targets" | "too_many_targets" | "invalid_number";

export type ForwardParse =
  | { ok: true; messageId: string; targets: string[] }
  | { ok: false; error: ForwardParseError };

/**
 * Normaliza um destino: dígitos de pessoa (>= 10) ou `<dígitos>@g.us` de grupo.
 * Devolve null quando não dá para enviar.
 */
function normalizeTarget(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.toLowerCase().endsWith("@g.us")) {
    const digits = value.slice(0, -5).replace(/\D/g, "");
    return digits.length >= 10 ? `${digits}@g.us` : null;
  }
  const digits = value.split("@")[0].replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

export function parseForwardRequest(payload: unknown): ForwardParse {
  if (!payload || typeof payload !== "object") return { ok: false, error: "invalid_request" };
  const { source_message_id: id, targets: raw } = payload as Record<string, unknown>;
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "invalid_request" };
  if (!Array.isArray(raw)) return { ok: false, error: "invalid_request" };
  if (raw.length === 0) return { ok: false, error: "no_targets" };

  const targets: string[] = [];
  for (const item of raw) {
    const n = normalizeTarget(item);
    if (!n) return { ok: false, error: "invalid_number" };
    if (!targets.includes(n)) targets.push(n);
  }
  if (targets.length > FORWARD_MAX_TARGETS) return { ok: false, error: "too_many_targets" };
  return { ok: true, messageId: id, targets };
}

/** Mesmo critério do front: só subdomínio de whatsapp.net/.com, por hostname. */
export function isWhatsAppCdnUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return host.endsWith(".whatsapp.net") || host.endsWith(".whatsapp.com");
  } catch {
    return false;
  }
}

export interface ForwardSource {
  message_type?: string | null;
  content?: string | null;
  media_url?: string | null;
  media_file_name?: string | null;
  media_expired?: boolean | null;
  deleted_at?: string | null;
}

export type ForwardMediaType = "image" | "video" | "document" | "audio" | "ptt" | "sticker";

export type ForwardPlan =
  | { kind: "text"; text: string }
  | { kind: "media"; type: ForwardMediaType; file: string; filename?: string; caption?: string };

export type ForwardPlanError = "not_forwardable" | "media_unavailable";

export type ForwardPlanResult = { ok: true; plan: ForwardPlan } | { ok: false; error: ForwardPlanError };

const TEXT_TYPES = new Set(["text", "conversation"]);
const MEDIA_TYPES: Record<string, ForwardMediaType> = {
  image: "image",
  video: "video",
  document: "document",
  audio: "audio",
  ptt: "ptt",
  sticker: "sticker",
};

/**
 * O que sai é decidido pelo registro do BANCO, nunca pelo corpo do pedido: o
 * cliente só diz qual mensagem e para quem. Mídia só vai se já houver arquivo
 * nosso — o link criptografado da CDN do WhatsApp não é enviável, e baixar mídia
 * de grupo continua sendo decisão de custo do cliente (clique), não deste envio.
 */
export function planForward(src: ForwardSource): ForwardPlanResult {
  if (src.deleted_at) return { ok: false, error: "not_forwardable" };
  const type = src.message_type ?? "";
  const content = (src.content ?? "").trim();

  if (TEXT_TYPES.has(type)) {
    return content ? { ok: true, plan: { kind: "text", text: content } } : { ok: false, error: "not_forwardable" };
  }

  const mediaType = MEDIA_TYPES[type];
  if (!mediaType) return { ok: false, error: "not_forwardable" };

  const file = src.media_url ?? "";
  if (!file || src.media_expired || isWhatsAppCdnUrl(file)) return { ok: false, error: "media_unavailable" };

  const plan: ForwardPlan = { kind: "media", type: mediaType, file };
  if (mediaType === "document" && src.media_file_name?.trim()) plan.filename = src.media_file_name.trim();
  if (content && mediaType !== "ptt" && mediaType !== "audio" && mediaType !== "sticker") plan.caption = content;
  return { ok: true, plan };
}

/** O governor segurou este envio (dedup, assinatura): não é falha do provedor. */
export class ForwardSkippedError extends Error {
  constructor() {
    super("forward_skipped");
  }
}

export interface ForwardResult {
  number: string;
  ok: boolean;
  /** Código curto; nunca a mensagem crua do provedor. */
  error?: "send_failed" | "skipped";
}

export interface ForwardDeps {
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

/**
 * Envia em série, com pausa entre destinos (nenhuma antes do primeiro nem depois
 * do último). Falha de um destino não derruba os demais.
 */
export async function runForward(
  plan: ForwardPlan,
  targets: string[],
  send: (number: string, plan: ForwardPlan) => Promise<unknown>,
  deps: ForwardDeps,
): Promise<ForwardResult[]> {
  const results: ForwardResult[] = [];
  for (let i = 0; i < targets.length; i++) {
    if (i > 0) {
      const gap = FORWARD_GAP_MIN_MS + Math.floor(deps.random() * (FORWARD_GAP_MAX_MS - FORWARD_GAP_MIN_MS));
      await deps.sleep(gap);
    }
    try {
      await send(targets[i], plan);
      results.push({ number: targets[i], ok: true });
    } catch (err) {
      results.push({ number: targets[i], ok: false, error: err instanceof ForwardSkippedError ? "skipped" : "send_failed" });
    }
  }
  return results;
}
