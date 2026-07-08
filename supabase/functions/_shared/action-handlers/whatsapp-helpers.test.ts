/**
 * Behaviour tests for resolveVariables — {{tag.<name>}} resolution.
 *
 * A Tag template variable echoes the tag name only when the Lead carries that
 * tag, else empty (a conditional echo, not a value lookup). See CONTEXT.md →
 * Template Variable.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { resolveVariables, isRetryableSendFailure } from "./whatsapp-helpers.ts";

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
    name: "Bar do Zé", company: "Bar do Zé", email: "", phone: "",
    pipe_whatsapp: "novo", qualification_score: null, rating: null,
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
