/**
 * reputation-signal — classifies provider 4xx responses that smell like a
 * ban/block/rate-limit and records them OUT-OF-BAND (anti-ban Onda 0 QW4).
 *
 * Invariants (chat-safety contract — do not relax):
 *  - NEVER feeds the uazapi-client circuit breaker. A 463/429/403 must not
 *    open the breaker that would block healthy sends (including the human
 *    composer) for 2 minutes. This module has no reference to that state.
 *  - NEVER throws and is never awaited on the send path — pure best-effort
 *    telemetry. A logging failure cannot change a send's outcome.
 *  - No Deno-only TOP-LEVEL dependency, mirroring uazapi-client's Node/Vitest
 *    contract; the runtime_logs persist is a guarded, fire-and-forget dynamic
 *    import of logger.ts.
 *  - The raw instance token NEVER leaves this module — the aggregation key is
 *    a one-way FNV-1a hash (logger.ts would redact any key containing "token"
 *    anyway, so the payload key is `instance_key`).
 */

const BAN_HINT_RE = /ban|block|spam|rate|forbidden/i;

/** HTTP statuses treated as ban-ish regardless of body. 463 = Meta/WhatsApp
 *  temporary restriction (Elvéra incident 2026-07-14); 429 rate limit; 403
 *  forbidden. */
export const BAN_SIGNAL_STATUSES: ReadonlySet<number> = new Set([403, 429, 463]);

export interface BanSignalClassification {
  isBanSignal: boolean;
  /** Which discriminator fired. */
  matchedBy?: "status" | "body";
}

/**
 * Pure classifier: status ∈ {403, 429, 463} OR the response body/message
 * matches /ban|block|spam|rate|forbidden/i.
 */
export function classifyBanSignal(
  status: number,
  body?: unknown,
  message?: string,
): BanSignalClassification {
  if (BAN_SIGNAL_STATUSES.has(status)) return { isBanSignal: true, matchedBy: "status" };
  const text = `${message ?? ""} ${safeStringify(body)}`;
  if (BAN_HINT_RE.test(text)) return { isBanSignal: true, matchedBy: "body" };
  return { isBanSignal: false };
}

function safeStringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.slice(0, 2_000);
  try {
    return JSON.stringify(v).slice(0, 2_000);
  } catch {
    return "";
  }
}

/** FNV-1a 32-bit — stable per-token aggregation key that never exposes the
 *  token itself ("Token never appears in logs", uazapi-client contract). */
export function instanceKeyFromToken(token: string | undefined): string {
  if (!token) return "unknown";
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface BanSignalEvent {
  status: number;
  providerCode?: string;
  matchedBy: "status" | "body";
  path: string;
  instanceKey: string;
  /**
   * The WhatsApp number's DB id, WHEN the caller knows it. The uazapi-client
   * request() scope only holds a per-instance TOKEN (hashed into instanceKey),
   * never the id — so this is usually undefined there. When a construction site
   * DOES supply it (UazapiClientConfig.instanceId), the signal additionally
   * feeds the Send Governor reputation state machine via record_ban_signal().
   * Dormant until wiring threads the id through; keeps the token-hash telemetry
   * path 100% unchanged when absent.
   */
  instanceId?: string;
}

// In-memory per-isolate counter — cheap aggregation + test observability. The
// durable trail is the runtime_logs row (and the structured console line that
// lands in the function logs regardless).
const counts = new Map<string, number>();

/**
 * Record one ban-ish 4xx. Increments the in-isolate counter, emits a
 * structured console line (tag: reputation_ban_signal) and best-effort
 * persists to runtime_logs. Never throws.
 */
export function recordBanSignal(ev: BanSignalEvent): void {
  try {
    const count = (counts.get(ev.instanceKey) ?? 0) + 1;
    counts.set(ev.instanceKey, count);
    console.warn(
      JSON.stringify({
        tag: "reputation_ban_signal",
        instance_key: ev.instanceKey,
        status: ev.status,
        provider_code: ev.providerCode ?? null,
        matched_by: ev.matchedBy,
        path: ev.path,
        count_in_isolate: count,
      }),
    );
    persistBestEffort(ev, count);
    // Send Governor bridge: only when the DB id is known (dormant otherwise).
    if (ev.instanceId) feedReputationBestEffort(ev.instanceId, ev.status);
  } catch {
    // telemetry must never affect the send result
  }
}

function persistBestEffort(ev: BanSignalEvent, count: number): void {
  try {
    // logger.ts is Deno-only (esm.sh import + Deno.env); load it lazily and
    // only where Deno exists so this module stays Node/Vitest-safe.
    const deno = (globalThis as {
      Deno?: { env?: { get?: (k: string) => string | undefined } };
    }).Deno;
    if (typeof deno?.env?.get !== "function") return;
    import("./logger.ts")
      .then(({ logRuntime }) =>
        logRuntime({
          module: "whatsapp",
          action: "reputation_ban_signal",
          status: "error",
          // Prefer the DB id for correlation when known; else the token hash.
          entityType: ev.instanceId ? "whatsapp_instance" : "whatsapp_instance_key",
          entityId: ev.instanceId ?? ev.instanceKey,
          payloadSnapshot: {
            http_status: ev.status,
            provider_code: ev.providerCode ?? null,
            matched_by: ev.matchedBy,
            path: ev.path,
            count_in_isolate: count,
            instance_id: ev.instanceId ?? null,
          },
        }),
      )
      .catch(() => {
        /* best-effort */
      });
  } catch {
    // best-effort
  }
}

/**
 * Feed the ban signal into the Send Governor reputation state machine via the
 * record_ban_signal RPC. Best-effort, fire-and-forget, Deno-guarded (lazily
 * builds a service-role client, same pattern as logger.ts) so the module stays
 * Node/Vitest-safe. Only ever called with a known instance id.
 */
function feedReputationBestEffort(instanceId: string, code: number): void {
  try {
    const deno = (globalThis as {
      Deno?: { env?: { get?: (k: string) => string | undefined } };
    }).Deno;
    if (typeof deno?.env?.get !== "function") return;
    const url = deno.env.get("SUPABASE_URL");
    const key = deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    import("https://esm.sh/@supabase/supabase-js@2")
      .then(({ createClient }) => {
        // `autoRefreshToken: false`: senão o auth-js arma um `setInterval` de
        // 30 s por cliente e ninguém o desarma. Ver `_shared/supabase-admin.ts`.
        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        return supabase.rpc("record_ban_signal", {
          p_instance_id: instanceId,
          p_code: code,
        });
      })
      .catch(() => {
        /* best-effort — reputation update never affects the send */
      });
  } catch {
    // best-effort
  }
}

/** @internal test hook */
export function _banSignalCounts(): Map<string, number> {
  return counts;
}

/** @internal test hook */
export function _resetBanSignalCounts(): void {
  counts.clear();
}
