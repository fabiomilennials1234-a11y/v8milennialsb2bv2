import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { moveDealsBulk, TETO_LOTE } from "./deals-move-bulk.ts";
import type { ApiRouteContext } from "../router.ts";

const cors = { "access-control-allow-origin": "*" };

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

type Resposta = { data?: unknown; error?: unknown };

/**
 * `porDeal` responde por identificador — é o que permite exercitar lote em que
 * um item falha e os outros andam, que é o comportamento inteiro desta rota.
 */
function ctx(
  body: unknown,
  porDeal: (dealId: string) => Resposta,
  calls: RpcCall[] = [],
): ApiRouteContext {
  return {
    req: new Request("https://x/api/v1/deals/move", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params: {},
    organizationId: "org-1",
    scopes: ["deal:write"],
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve(porDeal(String(args.p_deal_id)));
      },
    },
    cors,
  } as unknown as ApiRouteContext;
}

function movido(dealId: string, stage = "enviada"): Resposta {
  return {
    data: {
      id: dealId,
      last_activity_at: "2026-08-25T00:00:00Z",
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
      stage_key: stage,
    },
  };
}

const CORPO = { deal_ids: ["d-1", "d-2"], pipeline: "propostas", stage: "enviada" };

// ── O caminho feliz ────────────────────────────────────────────────────────

Deno.test("moveDealsBulk — move a lista e devolve a contagem", async () => {
  const calls: RpcCall[] = [];
  const res = await moveDealsBulk(ctx(CORPO, movido, calls));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.requested, 2);
  assertEquals(body.moved, 2);
  assertEquals(body.failed, 0);
  assertEquals(body.results.map((r: { deal_id: string }) => r.deal_id), ["d-1", "d-2"]);
  assertEquals(calls.length, 2);
  assertEquals(calls.every((c) => c.name === "api_move_deal"), true);
});

// Delegar para o RPC unitário é o que garante a MESMA semântica do move de um só
// — mover é MOVER, funil customizado é recusado, org alheia é 404. Um segundo
// caminho de movimentação seria um segundo lugar para a regra divergir.
Deno.test("moveDealsBulk — cada item vai pelo mesmo RPC do move unitário", async () => {
  const calls: RpcCall[] = [];
  await moveDealsBulk(ctx(CORPO, movido, calls));

  assertEquals(calls[0].args.p_org, "org-1");
  assertEquals(calls[0].args.p_pipeline, "propostas");
  assertEquals(calls[0].args.p_stage, "enviada");
  assertEquals(calls[0].args.p_deal_id, "d-1");
});

// A posição devolvida é a que o banco confirmou, não a que o corpo pediu.
Deno.test("moveDealsBulk — o item traz a posição NOVA, vinda do banco", async () => {
  const res = await moveDealsBulk(ctx(CORPO, (id) => movido(id, "enviada")));

  const r = (await res.json()).results[0];
  assertEquals(r.status, "moved");
  assertEquals(r.pipeline, "propostas");
  assertEquals(r.stage, "enviada");
});

// A organização vem da chave, nunca do corpo — senão o lote seria a porta para
// mover Negócio de outro inquilino.
Deno.test("moveDealsBulk — organization_id do corpo é ignorado", async () => {
  const calls: RpcCall[] = [];
  await moveDealsBulk(ctx(
    { ...CORPO, organization_id: "org-alheia" },
    movido,
    calls,
  ));

  assertEquals(calls.every((c) => c.args.p_org === "org-1"), true);
});

// ── Falha parcial ──────────────────────────────────────────────────────────
//
// Um id inválido no meio da lista não pode abortar o resto, nem ser engolido.
// 200 porque a requisição foi processada; é o corpo que diz o que aconteceu com
// cada Negócio.

Deno.test("moveDealsBulk — um item falho não derruba os outros, e aparece no corpo", async () => {
  const res = await moveDealsBulk(ctx(
    { deal_ids: ["d-1", "d-2", "d-3"], pipeline: "propostas", stage: "enviada" },
    (id) =>
      id === "d-2"
        ? { error: { code: "P0002", message: "Negócio não encontrado nesta organização." } }
        : movido(id),
  ));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.moved, 2);
  assertEquals(body.failed, 1);
  const falho = body.results.find((r: { deal_id: string }) => r.deal_id === "d-2");
  assertEquals(falho.status, "failed");
  assertEquals(falho.error.code, "deal_not_found");
});

// `data` nulo sem erro é Negócio que não existe naquela organização. Tratar como
// sucesso faria o lote reportar movido o que não moveu.
Deno.test("moveDealsBulk — retorno vazio do banco é falha, não sucesso", async () => {
  const res = await moveDealsBulk(ctx(
    { deal_ids: ["d-1"], pipeline: "propostas", stage: "enviada" },
    () => ({ data: null }),
  ));

  const body = await res.json();
  assertEquals(body.moved, 0);
  assertEquals(body.results[0].error.code, "deal_not_found");
});

// ── Erro de destino interrompe ─────────────────────────────────────────────
//
// Funil ou etapa inexistentes falham IGUAL para todos os itens. Devolver cem
// vezes o mesmo erro faria o chamador procurar defeito nos ids.

Deno.test("moveDealsBulk — destino inválido para o lote e responde 422", async () => {
  const calls: RpcCall[] = [];
  const res = await moveDealsBulk(ctx(
    { deal_ids: ["d-1", "d-2", "d-3", "d-4", "d-5", "d-6"], pipeline: "inexistente", stage: "x" },
    () => ({ error: { code: "22023", message: "Funil de sistema inexistente não existe nesta organização." } }),
    calls,
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "invalid_pipeline_or_stage");
  // Parou: não gastou uma chamada por item da lista inteira.
  assertEquals(calls.length < 6, true);
});

Deno.test("moveDealsBulk — funil customizado como destino para o lote", async () => {
  const res = await moveDealsBulk(ctx(
    CORPO,
    () => ({ error: { message: "Mover para funil customizado não é suportado." } }),
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "custom_pipeline_not_supported");
});

// Omitir o que já andou faria o chamador retentar a lista inteira — movendo de
// novo o que já tinha movido.
Deno.test("moveDealsBulk — a interrupção diz o que já tinha movido", async () => {
  let chamadas = 0;
  const res = await moveDealsBulk(ctx(
    { deal_ids: ["d-1", "d-2"], pipeline: "propostas", stage: "enviada" },
    (id) => {
      chamadas++;
      return chamadas === 1
        ? movido(id)
        : { error: { code: "22023", message: "Etapa inválida" } };
    },
  ));

  assertEquals(res.status, 422);
  const detalhes = (await res.json()).error.details;
  assertEquals(Array.isArray(detalhes.moved), true);
});

// ── Recusas antes de tocar o banco ─────────────────────────────────────────

Deno.test("moveDealsBulk — corpo que não é objeto JSON é recusado", async () => {
  const calls: RpcCall[] = [];
  const res = await moveDealsBulk(ctx("não é json", movido, calls));

  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "invalid_body");
  assertEquals(calls.length, 0);
});

Deno.test("moveDealsBulk — sem deal_ids, recusa", async () => {
  const res = await moveDealsBulk(ctx({ pipeline: "propostas", stage: "enviada" }, movido));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "missing_deal_ids");
});

Deno.test("moveDealsBulk — lista vazia recusa, em vez de responder 'movi zero'", async () => {
  const res = await moveDealsBulk(ctx(
    { deal_ids: [], pipeline: "propostas", stage: "enviada" },
    movido,
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "empty_deal_ids");
});

Deno.test("moveDealsBulk — item que não é identificador recusa o lote inteiro", async () => {
  const calls: RpcCall[] = [];
  const res = await moveDealsBulk(ctx(
    { deal_ids: ["d-1", 42], pipeline: "propostas", stage: "enviada" },
    movido,
    calls,
  ));

  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "invalid_deal_ids");
  assertEquals(calls.length, 0);
});

// Truncar em silêncio faria o chamador acreditar que a lista inteira andou.
Deno.test("moveDealsBulk — acima do teto recusa, e não move os primeiros", async () => {
  const calls: RpcCall[] = [];
  const ids = Array.from({ length: TETO_LOTE + 1 }, (_, i) => `d-${i}`);
  const res = await moveDealsBulk(ctx(
    { deal_ids: ids, pipeline: "propostas", stage: "enviada" },
    movido,
    calls,
  ));

  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.error.code, "too_many_deals");
  assertEquals(body.error.details.max, TETO_LOTE);
  assertEquals(calls.length, 0);
});

Deno.test("moveDealsBulk — sem pipeline ou sem stage, recusa antes do banco", async () => {
  const calls: RpcCall[] = [];
  const semFunil = await moveDealsBulk(ctx({ deal_ids: ["d-1"], stage: "enviada" }, movido, calls));
  assertEquals((await semFunil.json()).error.code, "missing_pipeline");

  const semEtapa = await moveDealsBulk(ctx({ deal_ids: ["d-1"], pipeline: "propostas" }, movido, calls));
  assertEquals((await semEtapa.json()).error.code, "missing_stage");
  assertEquals(calls.length, 0);
});

// Mover duas vezes o mesmo Negócio grava duas passagens no histórico dele.
Deno.test("moveDealsBulk — id repetido move uma vez só", async () => {
  const calls: RpcCall[] = [];
  const res = await moveDealsBulk(ctx(
    { deal_ids: ["d-1", "d-1", "d-2"], pipeline: "propostas", stage: "enviada" },
    movido,
    calls,
  ));

  assertEquals(calls.length, 2);
  assertEquals((await res.json()).requested, 2);
});

// O teto do lote é o mesmo `?limit=` máximo da listagem, de propósito: uma
// página lida é uma página movida, sem o chamador ter que quebrar a lista.
Deno.test("moveDealsBulk — o teto do lote acompanha o teto da listagem", () => {
  assertEquals(TETO_LOTE, 100);
});
