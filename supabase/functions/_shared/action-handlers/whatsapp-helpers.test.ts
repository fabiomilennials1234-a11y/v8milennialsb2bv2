/**
 * Behaviour tests for resolveVariables — {{tag.<name>}} resolution.
 *
 * A Tag template variable echoes the tag name only when the Lead carries that
 * tag, else empty (a conditional echo, not a value lookup). See CONTEXT.md →
 * Template Variable.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { resolveVariables, isRetryableSendFailure, isInstanceLive } from "./whatsapp-helpers.ts";

/**
 * Minimal fake of the Supabase query builder used by resolveVariables.
 * Routes by table name; `single` feeds maybeSingle(), `list` feeds await.
 */
// deno-lint-ignore no-explicit-any
function fakeSupabase(tables: Record<string, { single?: any; list?: any[] }>): any {
  return {
    from(table: string) {
      const row = tables[table] || {};
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: row.single ?? null }),
        then: (resolve: (v: { data: unknown[] }) => unknown) =>
          resolve({ data: row.list ?? [] }),
      };
      return builder;
    },
  };
}

const LEAD = {
  single: {
    // SCRUM-202: `pipe_whatsapp` saiu do mock. A coluna já não é lida por
    // `resolveVariables` — `{estagio}` vem de `getPipeEntry` (ADR-0023 §10) —,
    // então mantê-la aqui só sugeria um contrato que não existe mais.
    name: "Bar do Zé", company: "Bar do Zé", email: "", phone: "",
    qualification_score: null, rating: null,
    sdr_id: null, closer_id: null, responsible_id: null,
    organization_id: "org-1", faturamento: null, segment: "",
    urgency: "", notes: "", origin: "",
  },
};

Deno.test("resolveVariables — {{tag.X}} renders the tag name when the Lead carries it", async () => {
  const supabase = fakeSupabase({
    leads: LEAD,
    lead_tags: { list: [{ tags: { name: "AÇAIZINHO" } }] },
  });

  const out = await resolveVariables(supabase, "lead-1", "linha {{tag.AÇAIZINHO}}");

  assertEquals(out, "linha AÇAIZINHO");
});

Deno.test("resolveVariables — {{tag.X}} of a tag the Lead lacks renders empty; owned tag still echoes", async () => {
  const supabase = fakeSupabase({
    leads: LEAD,
    lead_tags: { list: [{ tags: { name: "AÇAIZINHO" } }] },
  });

  const out = await resolveVariables(
    supabase,
    "lead-1",
    "linha {{tag.AÇAIZINHO}}{{tag.XEQUE MATE}}",
  );

  assertEquals(out, "linha AÇAIZINHO");
});

Deno.test("resolveVariables — {{tag.X}} renders empty when the Lead has no tags", async () => {
  const supabase = fakeSupabase({ leads: LEAD, lead_tags: { list: [] } });

  const out = await resolveVariables(supabase, "lead-1", "linha {{tag.AÇAIZINHO}}.");

  assertEquals(out, "linha .");
});

/**
 * isRetryableSendFailure — the guard that stopped the SC Beauty "4× Bom dia"
 * duplicate sends. Ambiguous provider failures (5xx / timeout / network) may
 * have delivered the message, so they must NOT be retried; only failures we
 * know blocked the send before it left are retryable.
 */
Deno.test("isRetryableSendFailure — ambiguous 500/timeout/network are terminal (never retried)", () => {
  assertEquals(isRetryableSendFailure("WhatsApp send failed: Uazapi server error 500 on POST /send/text"), false);
  assertEquals(isRetryableSendFailure("WhatsApp send failed: Uazapi timeout after 15000ms on POST /send/text"), false);
  assertEquals(isRetryableSendFailure("Image send failed: Uazapi server error 500 on POST /send/media"), false);
  assertEquals(isRetryableSendFailure("network error"), false);
  assertEquals(isRetryableSendFailure(""), false);
  assertEquals(isRetryableSendFailure(undefined), false);
});

Deno.test("isRetryableSendFailure — pre-send blocks are retryable (message never left)", () => {
  assertEquals(isRetryableSendFailure("WhatsApp send failed: Circuit breaker open for /send/text until 2026-07-07T13:16"), true);
  assertEquals(isRetryableSendFailure("WhatsApp instance not available"), true);
  assertEquals(isRetryableSendFailure("Rate limit exceeded for instance abc"), true);
});

/**
 * isInstanceLive — the liveness predicate that gates BOTH the org-default
 * fallback and (new) the pinned-instance branch in getWhatsAppInstance. A node
 * that pins an instance later logged out or deleted at the provider (org
 * 163874dd: extinct Evolution instance) must NOT be used blindly — the pin only
 * counts when the session is genuinely live. `status` freezes at "connected"
 * after a remote logout; `session_dead_since` (watchdog) is the real verdict.
 */
Deno.test("isInstanceLive — connected with no dead session is live", () => {
  assertEquals(isInstanceLive({ status: "connected", session_dead_since: null }), true);
  assertEquals(isInstanceLive({ status: "open", session_dead_since: null }), true);
  assertEquals(isInstanceLive({ status: "connected" }), true); // undefined dead_since
});

Deno.test("isInstanceLive — dead session or non-connected status is not live", () => {
  // status frozen at "connected" but the watchdog flagged the session dead (remote logout)
  assertEquals(isInstanceLive({ status: "connected", session_dead_since: "2026-07-07T20:10:00Z" }), false);
  assertEquals(isInstanceLive({ status: "disconnected", session_dead_since: null }), false);
  assertEquals(isInstanceLive({ status: "connecting", session_dead_since: null }), false);
  assertEquals(isInstanceLive({ status: null, session_dead_since: null }), false);
  assertEquals(isInstanceLive(null), false);
  assertEquals(isInstanceLive(undefined), false);
});
