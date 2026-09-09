import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { listLeads, searchLeads, serializeLeadRow } from "./leads.ts";
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
  params: Record<string, string> = {},
): ApiRouteContext {
  return {
    req: new Request(url),
    params,
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

// SCRUM-647, Etapa 2 — janela de depreciação de `rating`.
//
// Duas asserções, e as duas importam por motivos opostos:
//   * a chave AINDA EXISTE → cliente gerado da openapi.json não quebra durante
//     a janela;
//   * o valor é SEMPRE null → a API não devolve nota, mesmo que a RPC ainda
//     mande uma (durante o deploy escalonado ela manda: a migration vem depois).
// Sem a segunda, o campo continuaria vivo por inércia e a Etapa 2 ficaria pela
// metade sem ninguém perceber.
Deno.test("serializeLeadRow — rating está depreciado: chave presente, valor sempre null", () => {
  const out = serializeLeadRow(row("l1", "2026-06-14T10:00:00Z"));
  assertEquals("rating" in out, true);
  assertEquals(out.rating, null);
  // ...inclusive quando a linha da RPC ainda traz nota (deploy escalonado).
  const comNota = serializeLeadRow(row("l2", "2026-06-14T10:00:00Z", { rating: 9 }));
  assertEquals(comNota.rating, null);
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

// ── getLead (360) ──────────────────────────────────────────────

Deno.test("getLead — calls api_get_lead with org + lead id from params", async () => {
  const calls: RpcCall[] = [];
  const ctx = fakeCtx("https://x/api/v1/leads/l-9", { data: { id: "l-9", name: "Acme" } }, calls, { id: "l-9" });
  const { getLead } = await import("./leads.ts");
  await getLead(ctx);
  assertEquals(calls[0].name, "api_get_lead");
  assertEquals(calls[0].args, { p_org: "org-1", p_lead_id: "l-9" });
});

Deno.test("getLead — returns the 360 object verbatim (200)", async () => {
  const ctx = fakeCtx("https://x/api/v1/leads/l-9", { data: { id: "l-9", name: "Acme", tags: [] } }, [], { id: "l-9" });
  const { getLead } = await import("./leads.ts");
  const res = await getLead(ctx);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { id: "l-9", name: "Acme", tags: [] });
});

Deno.test("getLead — 404 when rpc returns null", async () => {
  const ctx = fakeCtx("https://x/api/v1/leads/missing", { data: null }, [], { id: "missing" });
  const { getLead } = await import("./leads.ts");
  const res = await getLead(ctx);
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "not_found");
});

Deno.test("getLead — 500 on rpc error", async () => {
  const ctx = fakeCtx("https://x/api/v1/leads/l-9", { error: { message: "x" } }, [], { id: "l-9" });
  const { getLead } = await import("./leads.ts");
  const res = await getLead(ctx);
  assertEquals(res.status, 500);
});

// ── getLeadTimeline ────────────────────────────────────────────

Deno.test("getLeadTimeline — calls api_lead_timeline with org, lead, limit+1, cursor", async () => {
  const calls: RpcCall[] = [];
  const ctx = fakeCtx("https://x/api/v1/leads/l-9/timeline?limit=2", { data: [] }, calls, { id: "l-9" });
  const { getLeadTimeline } = await import("./leads.ts");
  await getLeadTimeline(ctx);
  assertEquals(calls[0].name, "api_lead_timeline");
  assertEquals(calls[0].args, {
    p_org: "org-1",
    p_lead_id: "l-9",
    p_limit: 3,
    p_cursor_created_at: null,
    p_cursor_id: null,
  });
});

Deno.test("getLeadTimeline — has_more + next_cursor when limit+1 rows", async () => {
  const rows = [
    { id: "e3", created_at: "2026-06-03T00:00:00Z", action: "a" },
    { id: "e2", created_at: "2026-06-02T00:00:00Z", action: "b" },
    { id: "e1", created_at: "2026-06-01T00:00:00Z", action: "c" },
  ];
  const ctx = fakeCtx("https://x/api/v1/leads/l-9/timeline?limit=2", { data: rows }, [], { id: "l-9" });
  const { getLeadTimeline } = await import("./leads.ts");
  const res = await getLeadTimeline(ctx);
  const body = await res.json();
  assertEquals(body.data.length, 2);
  assertEquals(body.has_more, true);
  assertEquals(decodeCursor(body.next_cursor), { created_at: "2026-06-02T00:00:00Z", id: "e2" });
});

Deno.test("getLeadTimeline — 500 on rpc error", async () => {
  const ctx = fakeCtx("https://x/api/v1/leads/l-9/timeline", { error: { message: "x" } }, [], { id: "l-9" });
  const { getLeadTimeline } = await import("./leads.ts");
  const res = await getLeadTimeline(ctx);
  assertEquals(res.status, 500);
});

// ── GET /leads/search ──────────────────────────────────────────
//
// O passo de dedup que todo conector faz antes de criar. No jeito estrito
// (ADR/spec: `POST /deals` exige `lead_id`), esta rota é o que impede que a
// integração ingênua crie uma segunda pessoa — ela pergunta antes.
//
// Devolve LISTA, não um só: um telefone pode casar mais de um Lead, e esconder
// isso atrás de um resultado único faria a rota mentir exatamente onde a
// duplicata mora.

Deno.test("searchLeads — por telefone devolve os Leads que casam", async () => {
  const calls: RpcCall[] = [];
  const res = await searchLeads(fakeCtx(
    "https://x/api/v1/leads/search?phone=11999990000",
    { data: [row("l-1", "2026-01-01T00:00:00Z")] },
    calls,
  ));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.length, 1);
  assertEquals(body.data[0].id, "l-1");
  assertEquals(calls[0].args.p_phone, "11999990000");
});

// Busca sem critério não pode virar "liste tudo". Quem quer a base inteira usa
// `GET /leads`, que é paginado por cursor; esta rota é lookup e precisa de alvo.
// Sem a guarda, um parâmetro escrito errado no node vira varredura silenciosa.

Deno.test("searchLeads — sem telefone nem e-mail recusa, e não consulta o banco", async () => {
  const calls: RpcCall[] = [];
  const res = await searchLeads(fakeCtx(
    "https://x/api/v1/leads/search",
    { data: [] },
    calls,
  ));

  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.error.code, "missing_search_criteria");
  assertEquals(calls.length, 0);
});

Deno.test("searchLeads — por e-mail devolve os Leads que casam", async () => {
  const calls: RpcCall[] = [];
  const res = await searchLeads(fakeCtx(
    "https://x/api/v1/leads/search?email=joao@acme.com",
    { data: [row("l-7", "2026-01-01T00:00:00Z")] },
    calls,
  ));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data[0].id, "l-7");
  assertEquals(calls[0].args.p_email, "joao@acme.com");
  assertEquals(calls[0].args.p_phone, null);
});
