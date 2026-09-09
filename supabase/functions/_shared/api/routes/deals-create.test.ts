import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { createDeal } from "./deals-create.ts";
import type { ApiRouteContext } from "../router.ts";

const cors = { "access-control-allow-origin": "*" };

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function ctx(
  body: unknown,
  rpcResult: { data?: unknown; error?: unknown },
  calls: RpcCall[] = [],
  headers: Record<string, string> = {},
): ApiRouteContext {
  return {
    req: new Request("https://x/api/v1/deals", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers,
    }),
    params: {},
    organizationId: "org-1",
    scopes: ["deal:write"],
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
    },
    cors,
  } as unknown as ApiRouteContext;
}

const OK = { data: { status: "created", deal: { id: "d-1" } } };

// ── POST /deals — criação estrita ──────────────────────────────────────────
//
// Estilo Pipedrive: exige um Lead que JÁ EXISTE. Não aceita Lead embutido.
// Quem integra faz procurar → criar Lead → abrir Negócio. A recusa do corpo com
// Lead embutido é asserção, não detalhe: aceitar em silêncio criaria um segundo
// caminho de criação de pessoa, fora do 409 que o `POST /leads` garante.

Deno.test("createDeal — sem lead_id recusa, e não chama o banco", async () => {
  const calls: RpcCall[] = [];
  const res = await createDeal(ctx({ pipeline: "whatsapp", stage: "novo" }, OK, calls));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "missing_lead_id");
  assertEquals(calls.length, 0);
});

Deno.test("createDeal — Lead embutido é recusado; a criação é estrita", async () => {
  const calls: RpcCall[] = [];
  const res = await createDeal(ctx(
    { lead: { phone: "11999990000" }, pipeline: "whatsapp", stage: "novo" },
    OK,
    calls,
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "inline_lead_not_supported");
  assertEquals(calls.length, 0);
});

// A Procedência não é opcional para este caminho: um Negócio nascido da API tem
// de dizer que nasceu da API. Deixar o handler omitir seria abrir, no primeiro
// dia, o buraco que a decisão 4 do ADR-0030 existe para fechar.
Deno.test("createDeal — grava a Procedência como api", async () => {
  const calls: RpcCall[] = [];
  await createDeal(ctx(
    { lead_id: "l-1", pipeline: "whatsapp", stage: "novo" },
    OK,
    calls,
  ));

  assertEquals(calls[0].args.p_source, "api");
});

Deno.test("createDeal — repassa funil, etapa e os campos de dinheiro", async () => {
  const calls: RpcCall[] = [];
  await createDeal(ctx(
    { lead_id: "l-1", pipeline: "propostas", stage: "enviada", title: "Reposição", value: 1200 },
    OK,
    calls,
  ));

  assertEquals(calls[0].args.p_lead_id, "l-1");
  assertEquals(calls[0].args.p_pipe, "propostas");
  assertEquals(calls[0].args.p_stage, "enviada");
  assertEquals(calls[0].args.p_title, "Reposição");
  assertEquals(calls[0].args.p_value, 1200);
});

Deno.test("createDeal — criação devolve 201 com o Negócio", async () => {
  const res = await createDeal(ctx({ lead_id: "l-1", pipeline: "whatsapp", stage: "novo" }, OK));

  assertEquals(res.status, 201);
  assertEquals((await res.json()).id, "d-1");
});

// ── O sinal de segundo Negócio aberto no mesmo funil ───────────────────────
//
// Decisão do CTO: CRIA e sinaliza. É legal pelo modelo — é assim que recompra se
// representa. Mas o caso comum não é recompra, é a mesma pessoa preenchendo o
// mesmo anúncio duas vezes, então o silêncio seria caro.
//
// Medido em produção em 2026-08-23, logo após o backfill: ZERO Leads têm dois
// Negócios abertos no mesmo funil. É capacidade nova, e a primeira vez que
// acontecer alguém precisa perceber.

Deno.test("createDeal — segundo Negócio no mesmo funil é criado, e sinalizado", async () => {
  const res = await createDeal(ctx(
    { lead_id: "l-1", pipeline: "whatsapp", stage: "novo" },
    { data: {
      status: "created",
      deal: { id: "d-2" },
      warning: { code: "lead_has_open_deal_in_pipeline", open_deal_id: "d-1", stage: "respondeu" },
    } },
  ));

  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.id, "d-2");
  assertEquals(body.warning.code, "lead_has_open_deal_in_pipeline");
  assertEquals(body.warning.open_deal_id, "d-1");
});

// ── Idempotência: mesma mecânica do POST /leads ────────────────────────────

Deno.test("createDeal — a chave de idempotência chega ao banco", async () => {
  const calls: RpcCall[] = [];
  await createDeal(ctx(
    { lead_id: "l-1", pipeline: "whatsapp", stage: "novo" },
    OK,
    calls,
    { "Idempotency-Key": "k-7" },
  ));

  assertEquals(calls[0].args.p_idempotency_key, "k-7");
});

Deno.test("createDeal — replay devolve 200, não 201", async () => {
  const res = await createDeal(ctx(
    { lead_id: "l-1", pipeline: "whatsapp", stage: "novo" },
    { data: { status: "replayed", deal: { id: "d-1" } } },
    [],
    { "Idempotency-Key": "k-7" },
  ));

  assertEquals(res.status, 200);
});

// ── Erros do banco viram erro legível, não 500 ─────────────────────────────

Deno.test("createDeal — funil inexistente vira 422 com código próprio", async () => {
  const res = await createDeal(ctx(
    { lead_id: "l-1", pipeline: "inexistente", stage: "novo" },
    { error: { code: "22023", message: "Funil inexistente não abre negócio por esta porta." } },
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "invalid_pipeline_or_stage");
});

// ── Qualquer funil abre Negócio (SCRUM-625) ────────────────────────────────
//
// `pipeline` aceita id (uuid) ou slug de qualquer funil; etapa de funil custom
// aceita stage_key ou uuid. O handler repassa CRU — a tradução vive no banco
// (porta única `abrir_negocio`), então aqui o contrato é só o repasse e o mapa
// de erros.

Deno.test("createDeal — funil custom por uuid e etapa por stage_key chegam crus ao banco", async () => {
  const calls: RpcCall[] = [];
  await createDeal(ctx(
    { lead_id: "l-1", pipeline: "3a4a1a6e-9c1e-4f0a-8a2b-111111111111", stage: "onboarding" },
    OK,
    calls,
  ));

  assertEquals(calls[0].args.p_pipe, "3a4a1a6e-9c1e-4f0a-8a2b-111111111111");
  assertEquals(calls[0].args.p_stage, "onboarding");
});

Deno.test("createDeal — funil que não existe (mensagem nova do resolvedor) segue 422", async () => {
  const res = await createDeal(ctx(
    { lead_id: "l-1", pipeline: "nao-existe", stage: "novo" },
    { error: { code: "22023", message: 'Funil "nao-existe" não existe nesta organização. Use o id (uuid) ou o slug de um funil da organização.' } },
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "invalid_pipeline_or_stage");
});

Deno.test("createDeal — funil inativo vira 409 pipeline_inactive, como no move", async () => {
  const res = await createDeal(ctx(
    { lead_id: "l-1", pipeline: "pausado", stage: "novo" },
    { error: { code: "55000", message: 'Funil "pausado" está inativo nesta organização.' } },
  ));

  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, "pipeline_inactive");
});

Deno.test("createDeal — etapa que não existe no funil custom vira 422", async () => {
  const res = await createDeal(ctx(
    { lead_id: "l-1", pipeline: "pos-venda", stage: "fantasma" },
    { error: { code: "22023", message: 'Etapa "fantasma" não existe no funil 3a4a1a6e-9c1e-4f0a-8a2b-111111111111.' } },
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "invalid_pipeline_or_stage");
});

Deno.test("createDeal — Lead de outra organização vira 404, não 500", async () => {
  const res = await createDeal(ctx(
    { lead_id: "l-de-outra-org", pipeline: "whatsapp", stage: "novo" },
    { error: { code: "P0002", message: "Lead não encontrado (ou está na lixeira)." } },
  ));

  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "lead_not_found");
});
