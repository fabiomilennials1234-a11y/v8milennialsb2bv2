import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { createLead } from "./leads-create.ts";
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
    req: new Request("https://x/api/v1/leads", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers,
    }),
    params: {},
    organizationId: "org-1",
    scopes: ["lead:write"],
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
    },
    cors,
  } as unknown as ApiRouteContext;
}

// ── POST /leads — telefone já existente ────────────────────────
//
// O contrato que define esta rota: com telefone repetido a API NÃO cria uma
// segunda pessoa. Recusa, e devolve na recusa o que o chamador precisa para
// seguir — o identificador e o nome de quem já está lá. É isso que torna a
// integração ingênua correta por padrão: quem esqueceu de procurar antes
// recebe de volta exatamente o que a busca teria dado.

Deno.test("createLead — telefone já existente devolve 409 com o Lead que já existe", async () => {
  const res = await createLead(ctx(
    { name: "João", phone: "11999990000" },
    { data: { status: "conflict", lead: { id: "l-9", name: "João da Silva" } } },
  ));

  assertEquals(res.status, 409);

  const body = await res.json();
  assertEquals(body.error.code, "lead_already_exists");
  assertEquals(body.error.details.lead_id, "l-9");
  assertEquals(body.error.details.name, "João da Silva");
});

// ── POST /leads — idempotência ─────────────────────────────────
//
// Retentativa não é criação. Se a rede caiu entre a requisição e a resposta, o
// n8n manda de novo com a mesma chave — e precisa receber o MESMO Lead, com o
// status dizendo que nada foi criado desta vez. 201 aqui seria mentira: afirma
// criação onde houve replay.
//
// A atomicidade sob concorrência (duas requisições simultâneas com a mesma
// chave) não se prova nesta costura — dublê é sequencial. Isso é pgTAP.

Deno.test("createLead — replay da mesma chave devolve 200, não 201", async () => {
  const res = await createLead(ctx(
    { name: "João", phone: "11999990000" },
    { data: { status: "replayed", lead: { id: "l-9", name: "João" } } },
    [],
    { "Idempotency-Key": "k-1" },
  ));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.id, "l-9");
});

// A chave só serve se chegar ao guardião do registro. Esta é a asserção de
// maior fidelidade possível nesta costura: o efeito real — mesma chave, mesmo
// Lead — mora no banco e é provado lá.

Deno.test("createLead — a chave de idempotência chega ao banco", async () => {
  const calls: RpcCall[] = [];
  await createLead(ctx(
    { name: "João", phone: "11999990000" },
    { data: { status: "created", lead: { id: "l-1" } } },
    calls,
    { "Idempotency-Key": "k-42" },
  ));

  assertEquals(calls.length, 1);
  assertEquals(calls[0].args.p_idempotency_key, "k-42");
});

Deno.test("createLead — sem cabeçalho, a chave vai nula", async () => {
  const calls: RpcCall[] = [];
  await createLead(ctx(
    { name: "João", phone: "11999990000" },
    { data: { status: "created", lead: { id: "l-1" } } },
    calls,
  ));

  assertEquals(calls[0].args.p_idempotency_key, null);
});

// ── POST /leads — o corpo aceito é o corpo gravado ─────────────
//
// O defeito que estes testes travam: a rota respondia 201 e a RPC gravava cinco
// colunas — notes, segmento, faturamento e UTM sumiam em silêncio. Agora o que
// a rota aceita chega inteiro ao banco, e o que ela não grava é recusado antes
// de qualquer escrita.

const CREATED = { data: { status: "created", lead: { id: "l-1" } } };

Deno.test("createLead — notes, segment, faturamento e os cinco UTM chegam à RPC", async () => {
  const calls: RpcCall[] = [];
  const extras = {
    notes: "veio da landing",
    segment: "varejo",
    faturamento: "1M-5M",
    utm_source: "meta",
    utm_medium: "cpc",
    utm_campaign: "black-friday",
    utm_content: "video-1",
    utm_term: "crm",
  };
  const res = await createLead(ctx({ name: "João", phone: "11999990000", ...extras }, CREATED, calls));

  assertEquals(res.status, 201);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].args.p_lead, { name: "João", phone: "11999990000", ...extras });
});

Deno.test("createLead — chave desconhecida → 422 unknown_fields e o banco nem é chamado", async () => {
  const calls: RpcCall[] = [];
  const res = await createLead(ctx({ name: "João", foo: "x" }, CREATED, calls));

  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.error.code, "unknown_fields");
  assertEquals(body.error.details.fields, ["foo"]);
  assertEquals(/custom-fields/.test(body.error.details.hint), true);
  assertEquals(calls.length, 0);
});

Deno.test("createLead — campos desconhecidos voltam ordenados", async () => {
  const res = await createLead(ctx({ name: "João", zeta: 1, alfa: 2 }, CREATED));
  const body = await res.json();
  assertEquals(body.error.details.fields, ["alfa", "zeta"]);
});

Deno.test("createLead — chave do PATCH (sdr_id) → 422 com dica de PATCH, sem chamar o banco", async () => {
  const calls: RpcCall[] = [];
  const res = await createLead(ctx({ name: "João", sdr_id: "u-1" }, CREATED, calls));

  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.error.code, "unknown_fields");
  assertEquals(body.error.details.fields, ["sdr_id"]);
  assertEquals(/PATCH \/api\/v1\/leads\/\{id\}/.test(body.error.details.hint), true);
  assertEquals(/custom-fields/.test(body.error.details.hint), false);
  assertEquals(calls.length, 0);
});

Deno.test("createLead — objeto num campo → 422 invalid_value com o campo", async () => {
  const calls: RpcCall[] = [];
  const res = await createLead(ctx({ name: "João", notes: { a: 1 } }, CREATED, calls));

  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.error.code, "invalid_value");
  assertEquals(body.error.details.field, "notes");
  assertEquals(calls.length, 0);
});

Deno.test("createLead — booleano e array também são invalid_value", async () => {
  for (const v of [true, ["a"]]) {
    const res = await createLead(ctx({ name: "João", segment: v }, CREATED));
    assertEquals(res.status, 422);
    assertEquals((await res.json()).error.details.field, "segment");
  }
});

Deno.test("createLead — sem name, ou name em branco → 422 missing_name", async () => {
  for (const body of [{ phone: "11999990000" }, { name: "   " }, { name: null }]) {
    const calls: RpcCall[] = [];
    const res = await createLead(ctx(body, CREATED, calls));
    assertEquals(res.status, 422);
    assertEquals((await res.json()).error.code, "missing_name");
    assertEquals(calls.length, 0);
  }
});

Deno.test("createLead — número vira texto; null passa como null", async () => {
  const calls: RpcCall[] = [];
  await createLead(ctx({ name: "João", phone: 11999990000, faturamento: 50000, notes: null }, CREATED, calls));

  assertEquals(calls[0].args.p_lead, { name: "João", phone: "11999990000", faturamento: "50000", notes: null });
});

Deno.test("createLead — chave reusada com outro corpo → 409 lead_already_exists com reason", async () => {
  const res = await createLead(ctx(
    { name: "Maria", phone: "11888880000" },
    { data: { status: "conflict", reason: "idempotency_key_reused", lead: { id: "l-9", name: "João" } } },
    [],
    { "Idempotency-Key": "k-1" },
  ));

  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "lead_already_exists");
  assertEquals(body.error.details, { lead_id: "l-9", name: "João", reason: "idempotency_key_reused" });
});

Deno.test("createLead — conflito sem reason não inventa reason", async () => {
  const res = await createLead(ctx(
    { name: "João", phone: "11999990000" },
    { data: { status: "conflict", lead: { id: "l-9", name: "João" } } },
  ));
  const body = await res.json();
  assertEquals("reason" in body.error.details, false);
});
