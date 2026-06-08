/**
 * Behaviour tests for resolveVariables — {{tag.<name>}} resolution.
 *
 * A Tag template variable echoes the tag name only when the Lead carries that
 * tag, else empty (a conditional echo, not a value lookup). See CONTEXT.md →
 * Template Variable.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { resolveVariables } from "./whatsapp-helpers.ts";

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
