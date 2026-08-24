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

// ── only_active_stages ──────────────────────────────────────────────────────
//
// A tela do produto esconde etapa desativada (`usePipelineStages` filtra
// `is_active = true`). O catálogo passou a saber fazer o mesmo, sob demanda.
// O default NÃO filtra: mudar o que já é devolvido quebraria quem consome hoje.

const FUNIS = [
  {
    slug: "whatsapp",
    type: "system",
    stages: [
      { stage_key: "novo", name: "Novo Lead", is_active: true },
      { stage_key: "disparo_1", name: "Disparo 1 (24h)", is_active: false },
      { stage_key: "agendado", name: "Reunião Agendada", is_active: true },
    ],
  },
  { slug: "sem-etapas", type: "custom", stages: [] },
];

function ctxComUrl(url: string): ApiRouteContext {
  return {
    req: new Request(url),
    params: {},
    organizationId: "org-1",
    scopes: [],
    supabase: { rpc: () => Promise.resolve({ data: FUNIS }) },
    cors,
  };
}

Deno.test("pipelines — sem o parâmetro, devolve TODAS as etapas (contrato atual)", async () => {
  const res = await listPipelines(ctxComUrl("https://x/api/v1/pipelines"));
  const body = await res.json();
  assertEquals(body.data[0].stages.length, 3);
});

Deno.test("pipelines — only_active_stages=true devolve só o que aparece na tela", async () => {
  const res = await listPipelines(ctxComUrl("https://x/api/v1/pipelines?only_active_stages=true"));
  const body = await res.json();
  const chaves = body.data[0].stages.map((e: { stage_key: string }) => e.stage_key);
  assertEquals(chaves, ["novo", "agendado"]);
  // O funil sem etapas continua na lista — filtrar etapas não some com o funil.
  assertEquals(body.data.length, 2);
  assertEquals(body.data[1].stages, []);
});

Deno.test("pipelines — qualquer outro valor não filtra (só o literal 'true')", async () => {
  for (const v of ["1", "yes", "false", ""]) {
    const res = await listPipelines(ctxComUrl(`https://x/api/v1/pipelines?only_active_stages=${v}`));
    const body = await res.json();
    assertEquals(body.data[0].stages.length, 3, `valor ${v} não deveria filtrar`);
  }
});

// ── pipeline= (um funil só) ─────────────────────────────────────────────────
//
// Quem monta seletor de etapa quer UM funil. Sem isto, o cliente precisa baixar
// todos e filtrar do lado dele — e filtrar do lado de lá foi exatamente onde a
// primeira versão do seletor no Make errou, trazendo as etapas de todos os funis.

Deno.test("pipelines — pipeline=<slug> devolve só o funil de sistema pedido", async () => {
  const res = await listPipelines(ctxComUrl("https://x/api/v1/pipelines?pipeline=whatsapp"));
  const body = await res.json();
  assertEquals(body.data.length, 1);
  assertEquals(body.data[0].slug, "whatsapp");
});

Deno.test("pipelines — pipeline=<slug> combina com only_active_stages", async () => {
  const res = await listPipelines(
    ctxComUrl("https://x/api/v1/pipelines?pipeline=whatsapp&only_active_stages=true"),
  );
  const body = await res.json();
  assertEquals(body.data.length, 1);
  assertEquals(body.data[0].stages.map((e: { stage_key: string }) => e.stage_key), ["novo", "agendado"]);
});

Deno.test("pipelines — funil inexistente devolve lista vazia, não erro", async () => {
  const res = await listPipelines(ctxComUrl("https://x/api/v1/pipelines?pipeline=nao-existe"));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data, []);
});
