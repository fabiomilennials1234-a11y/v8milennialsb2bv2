import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { listLeads, serializeLeadRow } from "./leads.ts";
import type { ApiRouteContext } from "../router.ts";
import { decodeCursor } from "../cursor.ts";

const cors = { "access-control-allow-origin": "*" };

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function fakeCtx(
  url: string,
  rpcResult: { data?: unknown; error?: unknown },
  calls: RpcCall[] = [],
): ApiRouteContext {
  return {
    req: new Request(url),
    params: {},
    organizationId: "org-1",
    scopes: ["lead:read"],
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
    },
    cors,
  };
}

function row(id: string, created_at: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    created_at,
    name: "Acme",
    company: "Acme Co",
    email: "a@b.com",
    phone: "+5511999",
    origin: "meta_ads",
    rating: 4,
    qualification_score: 80,
    tier_efetivo: "ouro",
    tags: [{ id: "t1", name: "vip", color: "#fff" }],
    responsible_id: "u-1",
    sdr_id: null,
    closer_id: null,
    sold: false,
    sale_value: null,
    ...extra,
  };
}

Deno.test("serializeLeadRow — maps tier_efetivo→tier, drops internal columns", () => {
  const out = serializeLeadRow(row("l1", "2026-06-14T10:00:00Z", {
    organization_id: "org-1",
    is_shadow: false,
    deleted_at: null,
  }));
  assertEquals(out.tier, "ouro");
  assertEquals("tier_efetivo" in out, false);
  assertEquals("organization_id" in out, false);
  assertEquals("is_shadow" in out, false);
  assertEquals(out.id, "l1");
  assertEquals(out.tags, [{ id: "t1", name: "vip", color: "#fff" }]);
});

Deno.test("serializeLeadRow — null tags default to empty array", () => {
  const out = serializeLeadRow(row("l1", "2026-06-14T10:00:00Z", { tags: null }));
  assertEquals(out.tags, []);
});

Deno.test("listLeads — calls api_list_leads with org, parsed filters, limit+1, cursor", async () => {
  const calls: RpcCall[] = [];
  const ctx = fakeCtx(
    "https://x/api/v1/leads?stage=novo,abordado&tier=ouro&origin=meta_ads&responsible_id=u-1&created_from=2026-01-01&q=acme&limit=2",
    { data: [] },
    calls,
  );
  await listLeads(ctx);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_list_leads");
  assertEquals(calls[0].args, {
    p_org: "org-1",
    p_stage: ["novo", "abordado"],
    p_tier: ["ouro"],
    p_tag: null,
    p_origin: ["meta_ads"],
    p_responsible_id: "u-1",
    p_created_from: "2026-01-01",
    p_created_to: null,
    p_q: "acme",
    p_limit: 3,
    p_cursor_created_at: null,
    p_cursor_id: null,
  });
});

Deno.test("listLeads — passes decoded cursor parts to rpc", async () => {
  const calls: RpcCall[] = [];
  const { encodeCursor } = await import("../cursor.ts");
  const token = encodeCursor({ created_at: "2026-05-01T00:00:00Z", id: "prev" });
  const ctx = fakeCtx(`https://x/api/v1/leads?cursor=${token}`, { data: [] }, calls);
  await listLeads(ctx);
  assertEquals(calls[0].args.p_cursor_created_at, "2026-05-01T00:00:00Z");
  assertEquals(calls[0].args.p_cursor_id, "prev");
});

Deno.test("listLeads — has_more true when rpc returns limit+1; trims + sets next_cursor", async () => {
  const ctx = fakeCtx(
    "https://x/api/v1/leads?limit=2",
    { data: [row("a", "2026-06-03T00:00:00Z"), row("b", "2026-06-02T00:00:00Z"), row("c", "2026-06-01T00:00:00Z")] },
  );
  const res = await listLeads(ctx);
  const body = await res.json();
  assertEquals(body.data.length, 2);
  assertEquals(body.has_more, true);
  assertEquals(body.data.map((l: { id: string }) => l.id), ["a", "b"]);
  assertEquals(decodeCursor(body.next_cursor), { created_at: "2026-06-02T00:00:00Z", id: "b" });
});

Deno.test("listLeads — has_more false when fewer than limit+1; next_cursor null", async () => {
  const ctx = fakeCtx(
    "https://x/api/v1/leads?limit=2",
    { data: [row("a", "2026-06-03T00:00:00Z")] },
  );
  const res = await listLeads(ctx);
  const body = await res.json();
  assertEquals(body.data.length, 1);
  assertEquals(body.has_more, false);
  assertEquals(body.next_cursor, null);
});

Deno.test("listLeads — rpc error → 500 internal_error", async () => {
  const ctx = fakeCtx("https://x/api/v1/leads", { error: { message: "boom" } });
  const res = await listLeads(ctx);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "internal_error");
});
