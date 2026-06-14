import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { listCustomFields, listPipelines, listTags } from "./catalogs.ts";
import type { ApiRouteContext } from "../router.ts";

const cors = { "access-control-allow-origin": "*" };

function ctxWith(rpcResult: { data?: unknown; error?: unknown }, calls: { name: string }[] = []): ApiRouteContext {
  return {
    req: new Request("https://x/api/v1/catalog"),
    params: {},
    organizationId: "org-1",
    scopes: [],
    supabase: {
      rpc: (name: string, _args: Record<string, unknown>) => {
        calls.push({ name });
        return Promise.resolve(rpcResult);
      },
    },
    cors,
  };
}

const cases = [
  { fn: listPipelines, rpc: "api_list_pipelines", label: "pipelines" },
  { fn: listTags, rpc: "api_list_tags", label: "tags" },
  { fn: listCustomFields, rpc: "api_list_custom_fields", label: "custom-fields" },
];

for (const c of cases) {
  Deno.test(`${c.label} — calls ${c.rpc} and envelopes as non-paginated list`, async () => {
    const calls: { name: string }[] = [];
    const ctx = ctxWith({ data: [{ id: "1" }, { id: "2" }] }, calls);
    const res = await c.fn(ctx);
    assertEquals(calls[0].name, c.rpc);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.data.length, 2);
    assertEquals(body.has_more, false);
    assertEquals(body.next_cursor, null);
  });

  Deno.test(`${c.label} — null data → empty list`, async () => {
    const res = await c.fn(ctxWith({ data: null }));
    assertEquals((await res.json()).data, []);
  });

  Deno.test(`${c.label} — 500 on rpc error`, async () => {
    const res = await c.fn(ctxWith({ error: { message: "x" } }));
    assertEquals(res.status, 500);
  });
}
