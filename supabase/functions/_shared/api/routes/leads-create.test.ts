import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { createLeads, MAX_BATCH } from "./leads-create.ts";
import type { ApiRouteContext } from "../router.ts";

const cors = { "access-control-allow-origin": "*" };

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function ctx(
  body: unknown,
  rpcResult: { data?: unknown; error?: unknown } = { data: { ok: true, created: 1 } },
  calls: RpcCall[] = [],
): ApiRouteContext {
  return {
    req: new Request("https://x/api/v1/leads", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params: {},
    organizationId: "org-1",
    scopes: ["lead:ingest"],
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
    },
    cors,
  };
}

Deno.test("createLeads — passes org from the API key, never from the body", async () => {
  const calls: RpcCall[] = [];
  // A hostile caller trying to write into someone else's tenant.
  const c = ctx({
    organization_id: "org-DA-VITIMA",
    leads: [{ name: "Ana", phone: "+5511999999999" }],
  }, { data: { ok: true, created: 1, results: [] } }, calls);
  await createLeads(c);
  assertEquals(calls[0].name, "api_create_leads");
  assertEquals(calls[0].args.p_org, "org-1");
});

Deno.test("createLeads — accepts a bare array (n8n/Make cannot always wrap)", async () => {
  const calls: RpcCall[] = [];
  const c = ctx([{ name: "Ana" }], { data: { ok: true, created: 1, results: [] } }, calls);
  const res = await createLeads(c);
  assertEquals(res.status, 200);
  assertEquals((calls[0].args.p_leads as unknown[]).length, 1);
});

Deno.test("createLeads — forwards custom_fields and pipeline untouched", async () => {
  const calls: RpcCall[] = [];
  const lead = {
    name: "Ana",
    custom_fields: { segmento: "Metalurgia" },
    pipeline: { pipe: "pos-venda", stage: "onboarding" },
  };
  const c = ctx({ leads: [lead] }, { data: { ok: true, created: 1, results: [] } }, calls);
  await createLeads(c);
  assertEquals((calls[0].args.p_leads as unknown[])[0], lead);
});

Deno.test("createLeads — update_existing accepts boolean and the string form", async () => {
  for (const v of [true, "true"]) {
    const calls: RpcCall[] = [];
    const c = ctx({ leads: [{ name: "Ana" }], update_existing: v },
      { data: { ok: true, created: 0, updated: 1, results: [] } }, calls);
    await createLeads(c);
    assertEquals((calls[0].args.p_options as { update_existing: boolean }).update_existing, true);
  }
});

Deno.test("createLeads — update_existing defaults to false (never silently merges)", async () => {
  const calls: RpcCall[] = [];
  const c = ctx({ leads: [{ name: "Ana" }] }, { data: { ok: true, created: 1, results: [] } }, calls);
  await createLeads(c);
  assertEquals((calls[0].args.p_options as { update_existing: boolean }).update_existing, false);
});

Deno.test("createLeads — 400 on malformed JSON", async () => {
  const c = ctx("{nope", { data: { ok: true } });
  const res = await createLeads(c);
  assertEquals(res.status, 400);
});

Deno.test("createLeads — 400 when neither array nor { leads }", async () => {
  const res = await createLeads(ctx({ foo: "bar" }));
  assertEquals(res.status, 400);
});

Deno.test("createLeads — 422 on empty batch", async () => {
  const res = await createLeads(ctx({ leads: [] }));
  assertEquals(res.status, 422);
});

Deno.test("createLeads — 422 over the batch cap, without hitting the RPC", async () => {
  const calls: RpcCall[] = [];
  const leads = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ name: `L${i}` }));
  const res = await createLeads(ctx({ leads }, { data: { ok: true } }, calls));
  assertEquals(res.status, 422);
  assertEquals(calls.length, 0);
});

Deno.test("createLeads — surfaces the per-item report", async () => {
  const results = [
    { status: "created", lead_id: "l-1", warning: null },
    { status: "failed", code: "missing_identity" },
  ];
  const c = ctx({ leads: [{ name: "Ana" }, {}] },
    { data: { ok: true, created: 1, updated: 0, failed: 1, results } });
  const res = await createLeads(c);
  assertEquals(res.status, 200);
  // apiResource returns the resource bare — no { data } envelope (same as ping).
  const json = await res.json();
  assertEquals(json.created, 1);
  assertEquals(json.failed, 1);
  assertEquals(json.results, results);
});

Deno.test("createLeads — 500 when the RPC errors", async () => {
  const c = ctx({ leads: [{ name: "Ana" }] }, { error: { message: "boom" } });
  const res = await createLeads(c);
  assertEquals(res.status, 500);
});
