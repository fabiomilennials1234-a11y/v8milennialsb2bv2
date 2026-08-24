import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { getDeal, listDeals } from "./deals.ts";
import type { ApiRouteContext } from "../router.ts";
import { decodeCursor } from "../cursor.ts";

const cors = { "access-control-allow-origin": "*" };

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function ctx(
  url: string,
  rpcResult: { data?: unknown; error?: unknown },
  calls: RpcCall[] = [],
  params: Record<string, string> = {},
): ApiRouteContext {
  return {
    req: new Request(url),
    params,
    organizationId: "org-1",
    scopes: ["deal:read"],
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
    },
    cors,
  } as unknown as ApiRouteContext;
}

function row(id: string, last_activity_at: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    last_activity_at,
    created_at: "2026-01-01T00:00:00Z",
    title: "Negócio " + id,
    value: 1000,
    source: "api",
    won: null,
    closed_at: null,
    loss_reason: null,
    owner_id: "tm-1",
    source_lead_id: "l-1",
    pipeline_slug: "whatsapp",
    stage_key: "novo",
    ...extra,
  };
}

// ── GET /deals ─────────────────────────────────────────────────────────────

Deno.test("listDeals — devolve o envelope padrão de listagem", async () => {
  const res = await listDeals(ctx("https://x/api/v1/deals", { data: [row("d-1", "2026-08-01T00:00:00Z")] }));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.length, 1);
  assertEquals(body.has_more, false);
  assertEquals(body.next_cursor, null);
});

// A Procedência no corpo é o ponto do ADR-0030 §4 chegando a quem integra: sem
// ela, "quanto do meu funil veio de automação?" continua sem resposta de fora.
Deno.test("listDeals — o corpo traz a Procedência e a posição atual", async () => {
  const res = await listDeals(ctx("https://x/api/v1/deals", { data: [row("d-1", "2026-08-01T00:00:00Z")] }));

  const d = (await res.json()).data[0];
  assertEquals(d.source, "api");
  assertEquals(d.pipeline, "whatsapp");
  assertEquals(d.stage, "novo");
});

Deno.test("listDeals — repassa os filtros de funil, etapa, dono e situação", async () => {
  const calls: RpcCall[] = [];
  await listDeals(ctx(
    "https://x/api/v1/deals?pipeline=propostas&stage=enviada&owner_id=tm-9&status=open",
    { data: [] },
    calls,
  ));

  assertEquals(calls[0].args.p_pipeline, "propostas");
  assertEquals(calls[0].args.p_stage, "enviada");
  assertEquals(calls[0].args.p_owner_id, "tm-9");
  assertEquals(calls[0].args.p_status, "open");
});

// ── O cursor ───────────────────────────────────────────────────────────────
//
// Por ÚLTIMA ATIVIDADE, não por criação. É a coluna que #1766 criou e indexou, e
// é a que o #1771 vai usar para o `updated_since`. Paginar por criação agora e
// trocar depois seria quebra de contrato público para quem já estivesse
// paginando — o cliente guarda o cursor entre chamadas.

Deno.test("listDeals — o cursor é pela última atividade, não pela criação", async () => {
  const res = await listDeals(ctx(
    "https://x/api/v1/deals?limit=1",
    { data: [row("d-1", "2026-08-02T00:00:00Z"), row("d-2", "2026-08-01T00:00:00Z")] },
  ));

  const body = await res.json();
  assertEquals(body.has_more, true);
  assertEquals(body.data.length, 1);

  const c = decodeCursor(body.next_cursor);
  assertEquals(c?.id, "d-1");
  assertEquals(c?.created_at, "2026-08-02T00:00:00Z"); // o campo do cursor carrega a chave de ordenação
});

Deno.test("listDeals — pede uma linha a mais que o limite, para saber se há próxima", async () => {
  const calls: RpcCall[] = [];
  await listDeals(ctx("https://x/api/v1/deals?limit=25", { data: [] }, calls));

  assertEquals(calls[0].args.p_limit, 26);
});

Deno.test("listDeals — erro do banco não vaza como sucesso vazio", async () => {
  const res = await listDeals(ctx("https://x/api/v1/deals", { error: { message: "boom" } }));

  assertEquals(res.status, 500);
  assertEquals((await res.json()).error.code, "internal_error");
});

// ── GET /deals/{id} ────────────────────────────────────────────────────────

Deno.test("getDeal — devolve o Negócio com a posição, sem segunda chamada", async () => {
  const res = await getDeal(ctx(
    "https://x/api/v1/deals/d-1",
    { data: row("d-1", "2026-08-01T00:00:00Z") },
    [],
    { id: "d-1" },
  ));

  assertEquals(res.status, 200);
  const d = await res.json();
  assertEquals(d.id, "d-1");
  assertEquals(d.pipeline, "whatsapp");
  assertEquals(d.stage, "novo");
  assertEquals(d.source, "api");
});

// Negócio de outra organização e Negócio inexistente têm de ser
// INDISTINGUÍVEIS de fora: 404 nos dois casos. Responder 403 no primeiro
// confirmaria a existência do registro do vizinho.
Deno.test("getDeal — inexistente devolve 404", async () => {
  const res = await getDeal(ctx(
    "https://x/api/v1/deals/d-9",
    { data: null },
    [],
    { id: "d-9" },
  ));

  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "deal_not_found");
});

Deno.test("getDeal — a organização vai do contexto, nunca do caminho", async () => {
  const calls: RpcCall[] = [];
  await getDeal(ctx(
    "https://x/api/v1/deals/d-1",
    { data: row("d-1", "2026-08-01T00:00:00Z") },
    calls,
    { id: "d-1" },
  ));

  assertEquals(calls[0].args.p_org, "org-1");
  assertEquals(calls[0].args.p_deal_id, "d-1");
});

// ── updated_since — sincronização incremental (#1771) ──────────────────────
//
// É a peça que torna um node de n8n ou um cenário no Make possível: acordar de
// tempos em tempos e perguntar "o que mudou desde a última vez?".
//
// Sem ela, o conector só enxerga registro NOVO — um Negócio que mudou de etapa
// ontem seria invisível, que é justamente o evento que interessa.

Deno.test("listDeals — updated_since chega ao banco", async () => {
  const calls: RpcCall[] = [];
  await listDeals(ctx(
    "https://x/api/v1/deals?updated_since=2026-08-01T00:00:00Z",
    { data: [] },
    calls,
  ));

  assertEquals(calls[0].args.p_updated_since, "2026-08-01T00:00:00.000Z");
});

Deno.test("listDeals — sem updated_since, o corte vai nulo", async () => {
  const calls: RpcCall[] = [];
  await listDeals(ctx("https://x/api/v1/deals", { data: [] }, calls));

  assertEquals(calls[0].args.p_updated_since, null);
});

// Instante ilegível não pode virar "sem corte": o conector receberia a base
// inteira achando que recebeu só o delta, e processaria tudo de novo — em fluxo
// que dispara mensagem, isso é reenvio em massa.
Deno.test("listDeals — updated_since ilegível recusa, e não consulta o banco", async () => {
  const calls: RpcCall[] = [];
  const res = await listDeals(ctx(
    "https://x/api/v1/deals?updated_since=ontem",
    { data: [] },
    calls,
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "invalid_updated_since");
  assertEquals(calls.length, 0);
});

Deno.test("listDeals — updated_since aceita data sem hora", async () => {
  const calls: RpcCall[] = [];
  const res = await listDeals(ctx(
    "https://x/api/v1/deals?updated_since=2026-08-01",
    { data: [] },
    calls,
  ));

  assertEquals(res.status, 200);
  assertEquals(calls[0].args.p_updated_since, "2026-08-01T00:00:00.000Z");
});

// O cursor precisa da chave de ordenação num campo que `paginateByCursor` lê —
// que é `created_at`. Fazer isso sobrescrevendo o campo do PRÓPRIO objeto que vai
// para o corpo corrompe a resposta: o integrador receberia a última atividade
// rotulada como data de criação, e um relatório "negócios criados em agosto"
// contaria errado.
Deno.test("listDeals — created_at no corpo é a CRIAÇÃO, não a última atividade", async () => {
  const res = await listDeals(ctx(
    "https://x/api/v1/deals",
    { data: [row("d-1", "2026-08-20T00:00:00Z", { created_at: "2026-01-15T00:00:00Z" })] },
  ));

  const d = (await res.json()).data[0];
  assertEquals(d.created_at, "2026-01-15T00:00:00Z");
  assertEquals(d.last_activity_at, "2026-08-20T00:00:00Z");
});
