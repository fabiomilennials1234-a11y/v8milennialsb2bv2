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
