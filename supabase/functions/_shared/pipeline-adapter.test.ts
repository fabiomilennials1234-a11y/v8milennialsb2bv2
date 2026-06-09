/**
 * Behaviour tests for resolveActiveStageKey — the ghost-stage ingest guard.
 *
 * External ingest (Make/n8n/Meta) sends a stage slug as a fixed string. If that
 * slug was deactivated/renamed in the org, the lead must NOT land in it (it would
 * be invisible in the Kanban). The resolver coerces the target to a real active
 * stage. See pipeline-adapter.ts.
 */
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { resolveActiveStageKey } from "./pipeline-adapter.ts";

/**
 * Minimal fake of the Supabase query builder used by resolveActiveStageKey.
 * The chain is awaitable (then) and resolves { data, error }.
 */
// deno-lint-ignore no-explicit-any
function fakeSupabase(result: { data?: any[]; error?: unknown }): any {
  return {
    from() {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
      };
      return builder;
    },
  };
}

const ACTIVE = [
  { stage_key: "novo_lead", position: 0 },
  { stage_key: "abordado", position: 1 },
  { stage_key: "agendado", position: 4 },
];

Deno.test("requested stage that is active → returned as-is", async () => {
  const supa = fakeSupabase({ data: ACTIVE });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp", "abordado");
  assertEquals(got, "abordado");
});

Deno.test("requested stage NOT active → remapped to first active (min position)", async () => {
  const supa = fakeSupabase({ data: ACTIVE });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp", "novo");
  assertEquals(got, "novo_lead");
});

Deno.test("no requested stage → first active stage", async () => {
  const supa = fakeSupabase({ data: ACTIVE });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp");
  assertEquals(got, "novo_lead");
});

Deno.test("org has no active stages → null (caller falls back)", async () => {
  const supa = fakeSupabase({ data: [] });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp", "novo");
  assertEquals(got, null);
});

Deno.test("query error → trusts the requested value (never drops the lead)", async () => {
  const supa = fakeSupabase({ error: { message: "boom" } });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp", "abordado");
  assertEquals(got, "abordado");
});
