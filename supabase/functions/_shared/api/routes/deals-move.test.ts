import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { moveDeal } from "./deals-move.ts";
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
  params: Record<string, string> = { id: "d-1" },
): ApiRouteContext {
  return {
    req: new Request("https://x/api/v1/deals/d-1/move", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params,
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

const MOVIDO = {
  data: {
    id: "d-1",
    last_activity_at: "2026-08-24T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    title: "N",
    value: 100,
    source: "api",
    won: null,
    closed_at: null,
    loss_reason: null,
    owner_id: null,
    source_lead_id: "l-1",
    pipeline_slug: "propostas",
    stage_key: "enviada",
  },
};

// ── POST /deals/{id}/move ──────────────────────────────────────────────────
//
// Mover é MOVER, não copiar (ADR-0023 decisão 4). Antes deste modelo, chegar na
// etapa de sucesso fazia duas escritas — atualizava a origem e inseria um card
// novo no destino — e o gêmeo ficava para trás. Era ele que fazia o mesmo Lead
// aparecer em Qualificação e em Orçamentos ao mesmo tempo.

Deno.test("moveDeal — move para outro funil e etapa", async () => {
  const calls: RpcCall[] = [];
  const res = await moveDeal(ctx({ pipeline: "propostas", stage: "enviada" }, MOVIDO, calls));

  assertEquals(res.status, 200);
  assertEquals(calls[0].args.p_deal_id, "d-1");
  assertEquals(calls[0].args.p_pipeline, "propostas");
  assertEquals(calls[0].args.p_stage, "enviada");
});

Deno.test("moveDeal — o corpo devolve a POSIÇÃO NOVA, não a antiga", async () => {
  const res = await moveDeal(ctx({ pipeline: "propostas", stage: "enviada" }, MOVIDO));

  const d = await res.json();
  assertEquals(d.pipeline, "propostas");
  assertEquals(d.stage, "enviada");
});

Deno.test("moveDeal — sem etapa é recusado antes do banco", async () => {
  const calls: RpcCall[] = [];
  const res = await moveDeal(ctx({ pipeline: "propostas" }, MOVIDO, calls));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "missing_stage");
  assertEquals(calls.length, 0);
});

Deno.test("moveDeal — sem funil é recusado antes do banco", async () => {
  const calls: RpcCall[] = [];
  const res = await moveDeal(ctx({ stage: "enviada" }, MOVIDO, calls));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "missing_pipeline");
  assertEquals(calls.length, 0);
});

// Funil customizado como DESTINO é recusado pela função de banco, de propósito:
// card de funil custom vive em outra tabela, espelhada por chave primária, e a
// sincronia nunca reescreve o funil. Atravessar essa fronteira obrigaria apagar
// e recriar — o Negócio sobrevive, mas o card perde o id e leva o histórico
// junto. A função recusa em vez de fingir que resolve.
Deno.test("moveDeal — destino em funil customizado vira 422 legível", async () => {
  const res = await moveDeal(ctx(
    { pipeline: "custom:abc", stage: "x" },
    { error: { code: "22023", message: "Destino em funil customizado não é suportado." } },
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "custom_pipeline_not_supported");
});

Deno.test("moveDeal — Negócio inexistente ou de outra org devolve 404", async () => {
  const res = await moveDeal(ctx(
    { pipeline: "propostas", stage: "enviada" },
    { error: { code: "P0002", message: "Negócio não encontrado nesta organização." } },
  ));

  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "deal_not_found");
});

Deno.test("moveDeal — etapa que não pertence ao funil vira 422 com código próprio", async () => {
  const res = await moveDeal(ctx(
    { pipeline: "propostas", stage: "inexistente" },
    { error: { code: "23514", message: "Etapa inexistente não pertence ao funil propostas." } },
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "invalid_pipeline_or_stage");
});

Deno.test("moveDeal — responsável opcional é repassado", async () => {
  const calls: RpcCall[] = [];
  await moveDeal(ctx({ pipeline: "propostas", stage: "enviada", owner_id: "tm-3" }, MOVIDO, calls));

  assertEquals(calls[0].args.p_owner_id, "tm-3");
});
