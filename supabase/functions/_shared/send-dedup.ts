// deno-lint-ignore-file no-explicit-any
/**
 * send-dedup — idempotência atômica para todo caminho de envio de mensagem.
 *
 * Race-free: `tryReserveSend` usa `INSERT ... ON CONFLICT DO NOTHING RETURNING`
 * contra `send_dedup_log` (unique constraint cobre conteúdo dentro da janela,
 * E também `idempotency_key` separadamente).
 *
 * Callers: whatsapp-api-proxy, outbound-sender, workflow-executor send action,
 * copilot/dispatcher, process-copilot-followups.
 */

import { logRuntime } from "./logger.ts";

export type SendSource =
  | "manual"
  | "copilot"
  | "copilot_v2"
  | "workflow"
  | "mass_send"
  | "followup";

const DEFAULT_WINDOWS_SECONDS: Record<SendSource, number> = {
  manual: 10,
  // 60s escapava o loop lento do Bertin ("12× em 30min" ≈ 150s de espaçamento).
  // 300s cobre 150s com 2× de margem e ainda mata o loop rápido (3000/9h ≈ 11s).
  copilot: 300,
  copilot_v2: 300,
  workflow: 300,
  mass_send: 86_400,
  followup: 3_600,
};

/**
 * Limiar por source — a N-ésima ocorrência idêntica (com gap < janela) em que o
 * dedup passa a SUPRIMIR. Separa por FREQUÊNCIA, não por tamanho (o loop do
 * Bertin é "Oi Filipe!" = 10 chars; piso de tamanho não fecha).
 *
 *   copilot* : 3 (permite 2 — ack legítimo "Ok"/"Certo" 2× passa; barra da 3ª).
 *              Medição de prod: 520 rajadas-de-2 legítimas vs 3 loops de 12+.
 *   demais   : 2 (barra a 2ª — repetir literal em workflow/mass é quase sempre bug;
 *              o dado de conversa não vale lá). = comportamento do #1252.
 * Env-tunável no eixo copilot (SEND_DEDUP_COPILOT_BAR_AT).
 */
export function dedupBarAt(source: SendSource): number {
  if (source === "copilot" || source === "copilot_v2") {
    const env = Number(Deno.env.get("SEND_DEDUP_COPILOT_BAR_AT"));
    return Number.isInteger(env) && env >= 2 ? env : 3;
  }
  return 2;
}

/**
 * Mapeia o `trackSource` livre do dispatch para o vocabulário fechado de
 * SendSource. O dedup mora dentro do governSend (choke único) e vê TODO
 * trackSource — então este mapa é a fronteira: conhecido → enum; fora-de-escopo
 * ou desconhecido → null (o chamador PULA o dedup, fail-open + loga 1×, nunca
 * classifica errado sob a chave errada). Puro/determinístico (unit sem DB).
 *
 * Os 7 trackSource órfãos que a Lanterna mapeou (não existiam no enum):
 *   copilot* (conversacional, bar-at-3): copilot, copilot_v2, copilot-followup,
 *     copilot-outbound, copilot-outbound-audio.
 *   FORA DE ESCOPO desta fatia (→ null, logado):
 *     carteira_bulk, dispatch-router-mass — bulk é dedup POR DESTINATÁRIO, não
 *       content-hash; fatia própria da Lanterna.
 *     portfolio_alert — notificação, não é o vetor de ban; deduplicar arriscaria
 *       falso-positivo num alerta legítimo. Fica de fora DE PROPÓSITO.
 */
const TRACK_SOURCE_MAP: Record<string, SendSource> = {
  manual: "manual",
  copilot: "copilot",
  copilot_v2: "copilot_v2",
  "copilot-followup": "copilot",
  "copilot-outbound": "copilot",
  "copilot-outbound-audio": "copilot",
  workflow: "workflow",
  mass_send: "mass_send",
  followup: "followup",
};
export function deriveSendSource(trackSource?: string | null): SendSource | null {
  if (!trackSource) return null;
  return TRACK_SOURCE_MAP[trackSource] ?? null;
}

// Zero-width characters: ZWSP (U+200B), ZWNJ (U+200C), ZWJ (U+200D), BOM (U+FEFF).
// Encoded as escapes so the regex source has no irregular whitespace.
const ZWJ_RE = /[\u200B-\u200D\uFEFF]/g;

/**
 * Normalize content for hashing: lowercase, trim, collapse whitespace,
 * strip zero-width joiners/spaces. Symmetric — same input always same output.
 */
export function normalizeContent(text: string): string {
  return text
    .replace(ZWJ_RE, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function getDefaultWindow(source: SendSource): number {
  return DEFAULT_WINDOWS_SECONDS[source];
}

/**
 * Kill-switch + allowlist do dedup conversacional (#1156). Default OFF =
 * comportamento byte-a-byte de hoje (o dedup no governSend vira no-op).
 * `SEND_DEDUP_CONVERSATIONAL_ENABLED` != 'true' → off. `SEND_DEDUP_CONVERSATIONAL_ORGS`
 * (csv de org ids) vazio → todas; preenchido → só essas (canário Milennials/Bertin).
 * É o que torna o blast-radius de 93 orgs operacionalmente seguro.
 */
export function conversationalDedupEnabled(orgId: string): boolean {
  if (Deno.env.get("SEND_DEDUP_CONVERSATIONAL_ENABLED") !== "true") return false;
  const allow = (Deno.env.get("SEND_DEDUP_CONVERSATIONAL_ORGS") ?? "").trim();
  if (!allow) return true;
  return allow.split(",").map((s) => s.trim()).filter(Boolean).includes(orgId);
}

export type DedupResult =
  | { kind: "ok"; token: string }
  | { kind: "duplicate"; firstSentAt: string; ttlSeconds: number };

export interface TryReserveSendArgs {
  supabase: any;
  orgId: string;
  phone: string;
  contentHash: string;
  source: SendSource;
  idempotencyKey?: string;
  windowSeconds?: number; // override default
}

/**
 * Reserva ATÔMICA por CONTAGEM contra `send_dedup_log`, via RPC `fn_reserve_send`.
 *
 * O núcleo é um UPSERT único (INSERT ... ON CONFLICT DO UPDATE) que devolve o
 * hit_count da chave com RESET-POR-GAP (contador zera se a janela anterior já
 * expirou). Race-free pelo índice único (não conta linhas). A supressão é por
 * FREQUÊNCIA: `duplicate` quando hit_count >= limiar do source (copilot bar-at-3,
 * demais bar-at-2). idk presente (chunking) → limiar 2 (só replay literal do
 * MESMO idk deduplica; chunks distintos têm idk distinto → sempre enviam).
 *
 * TETO (não é matador de loop): só pega repetição IDÊNTICA. Loop parafraseado
 * (LLM varia o texto) nunca repete hash — domínio do Send Governor (#1156) por
 * TAXA. Duas proteções, domínios disjuntos.
 */
export async function tryReserveSend(args: TryReserveSendArgs): Promise<DedupResult> {
  const ttl = args.windowSeconds ?? getDefaultWindow(args.source);

  const { data: hitCount, error } = await args.supabase.rpc("fn_reserve_send", {
    p_org_id: args.orgId,
    p_phone: args.phone,
    p_content_hash: args.contentHash,
    p_source: args.source,
    p_idempotency_key: args.idempotencyKey ?? null,
    p_ttl_seconds: ttl,
  });

  // Erro real de infra → lança pro wrapper fail-open deixar o envio passar
  // (nunca dropar mensagem de cliente por hiccup do dedup).
  if (error) {
    throw new Error(`send-dedup reserve failed: ${error.message ?? error}`);
  }

  const hit = typeof hitCount === "number" ? hitCount : 1;
  // idk presente = replay-dedup (barra a 2ª ocorrência do MESMO idk); idk NULL =
  // frequência por source.
  const barAt = args.idempotencyKey ? 2 : dedupBarAt(args.source);

  if (hit >= barAt) {
    return { kind: "duplicate", firstSentAt: "", ttlSeconds: ttl };
  }
  return { kind: "ok", token: String(hit) };
}

/**
 * Fail-open convenience wrapper for the common "reserve an outbound send by its
 * content, skip if it's a duplicate" flow. Hashes the content, reserves a slot,
 * and returns whether the caller should SKIP the send.
 *
 * Fail-open by design: if the dedup infra errors (table missing on an env, RLS,
 * transient DB blip), it returns `{ duplicate: false }` so the send proceeds.
 * Dropping a real customer message because a best-effort dedup hiccuped is worse
 * than the rare duplicate this guards against.
 *
 * Empty/whitespace content is never deduped (nothing meaningful to hash).
 */
export async function reserveSendOrSkip(args: {
  supabase: any;
  orgId: string;
  phone: string;
  content: string | null | undefined;
  source: SendSource;
  idempotencyKey?: string;
  windowSeconds?: number;
}): Promise<{ duplicate: boolean; firstSentAt?: string; ttlSeconds?: number }> {
  try {
    if (!args.orgId || !args.phone) return { duplicate: false };
    const text = (args.content ?? "").trim();
    if (!text) return { duplicate: false };

    const contentHash = await hashContent(text);
    const result = await tryReserveSend({
      supabase: args.supabase,
      orgId: args.orgId,
      phone: args.phone,
      contentHash,
      source: args.source,
      idempotencyKey: args.idempotencyKey,
      windowSeconds: args.windowSeconds,
    });

    if (result.kind === "duplicate") {
      console.warn(
        `[send-dedup] BLOCKED duplicate ${args.source} send to ${args.phone} ` +
        `(first sent ${result.firstSentAt}, ${result.ttlSeconds}s window)`,
      );
      return { duplicate: true, firstSentAt: result.firstSentAt, ttlSeconds: result.ttlSeconds };
    }
    return { duplicate: false };
  } catch (err) {
    // Fail-open POR DESIGN: nunca derrubar um envio porque a infra de dedup
    // falhou. MAS o fail-open tem que GRITAR — este exato caminho ficou MESES
    // silencioso (a tabela send_dedup_log nunca existiu em prod, todo reserve
    // caía aqui, e o único sinal era um console.warn que ninguém lê). Um alerta
    // ALTO em runtime_logs (status=error) faz a quebra permanente aparecer no
    // painel de observabilidade em vez de virar silêncio de novo.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[send-dedup] reserve failed, sending anyway (fail-open):", msg);
    await logRuntime({
      organizationId: args.orgId,
      module: "outbound",
      action: "dedup_reserve_fail_open",
      status: "error",
      errorMessage: msg,
      // sem conteúdo/telefone cru no log — só o suficiente para diagnosticar.
      payloadSnapshot: { source: args.source, has_idempotency_key: Boolean(args.idempotencyKey) },
    });
    return { duplicate: false };
  }
}

export async function hashContent(text: string): Promise<string> {
  const normalized = normalizeContent(text);
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 32);
}
