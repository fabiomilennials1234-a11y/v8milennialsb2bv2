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
  | "workflow"
  | "mass_send"
  | "followup";

const DEFAULT_WINDOWS_SECONDS: Record<SendSource, number> = {
  manual: 10,
  copilot: 60,
  workflow: 300,
  mass_send: 86_400,
  followup: 3_600,
};

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
 * Atomic reservation against `send_dedup_log`.
 *
 * Race-free: relies on PG unique partial indexes — the `INSERT ... ON CONFLICT
 * DO NOTHING RETURNING *` round-trip returns `null` data when another caller
 * already holds the slot in the active window.
 *
 * Idempotency key (if provided) bypasses content-hash dedup — same key replayed
 * inside the window is a no-op `ok` (caller's intent: retry the SAME logical
 * send, not a new one).
 */
export async function tryReserveSend(args: TryReserveSendArgs): Promise<DedupResult> {
  const ttl = args.windowSeconds ?? getDefaultWindow(args.source);
  const reservedAt = new Date();
  const expiresAt = new Date(reservedAt.getTime() + ttl * 1000);

  const row = {
    org_id: args.orgId,
    phone: args.phone,
    content_hash: args.contentHash,
    source: args.source,
    idempotency_key: args.idempotencyKey ?? null,
    reserved_at: reservedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  const { data: inserted, error: insertError } = await args.supabase
    .from("send_dedup_log")
    .insert(row)
    .select()
    .maybeSingle();

  // A unique violation (23505) IS the dedup signal — the slot is already held
  // inside the active window. Anything else is a real infra error and is thrown
  // so the caller's fail-open wrapper can let the send through (never drop a
  // customer message because the dedup table hiccuped).
  if (insertError && insertError.code !== "23505") {
    throw new Error(`send-dedup insert failed: ${insertError.message ?? insertError}`);
  }

  if (inserted) {
    return { kind: "ok", token: inserted.id };
  }

  // Conflict path — first check if the caller is replaying their own
  // idempotency key (legitimate retry of the same logical send).
  if (args.idempotencyKey) {
    const { data: idkMatch } = await args.supabase
      .from("send_dedup_log")
      .select("id")
      .eq("org_id", args.orgId)
      .eq("idempotency_key", args.idempotencyKey)
      .gt("expires_at", reservedAt.toISOString())
      .order("reserved_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (idkMatch) {
      return { kind: "ok", token: idkMatch.id };
    }
  }

  // Otherwise: content-hash conflict. Fetch the active row to report
  // firstSentAt + remaining TTL.
  const { data: existing } = await args.supabase
    .from("send_dedup_log")
    .select("reserved_at, expires_at")
    .eq("org_id", args.orgId)
    .eq("phone", args.phone)
    .eq("content_hash", args.contentHash)
    .eq("source", args.source)
    .gt("expires_at", reservedAt.toISOString())
    .order("reserved_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    // Conflict resolved between insert and select (TTL expired in the interval).
    // Treat as ok-not-reserved — caller may retry; safer to surface ok and let
    // the next call attempt re-reservation.
    return { kind: "ok", token: "race-recovered" };
  }

  const remainingMs = new Date(existing.expires_at).getTime() - reservedAt.getTime();
  return {
    kind: "duplicate",
    firstSentAt: existing.reserved_at,
    ttlSeconds: Math.max(0, Math.ceil(remainingMs / 1000)),
  };
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
