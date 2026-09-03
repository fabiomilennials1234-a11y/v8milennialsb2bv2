/* eslint-disable @typescript-eslint/no-explicit-any -- Dublê de teste. O cliente Supabase falso é um builder encadeável; tipá-lo com precisão exigiria enumerar a superfície do SDK sem ganhar segurança nenhuma no teste. Mesma justificativa dos irmãos pipeline-adapter-*.test.ts. */
/**
 * Contrato de resolução do adapter pós-SCRUM-623 (ADR-0034 "funil é funil").
 *
 * O que se prova aqui:
 *   1. resolve por SLUG de qualquer funil (sem filtro `type='system'`);
 *   2. resolve por UUID direto, sempre com recorte de org;
 *   3. aliases legados (`qualificacao`, `pipe_*`) só disparam quando a busca
 *      direta por slug não achou — funil real com o mesmo slug ganha do alias;
 *   4. inexistente/inativo/lookup falho → `PipelineResolutionError` TIPADO,
 *      nunca `null` silencioso; `tryResolvePipelineId` é a única porta de
 *      degradação, e degrada só para erro de resolução;
 *   5. cache por org: segunda resolução do mesmo ref não volta ao banco.
 */
import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.0";
import {
  __clearPipelineResolutionCache,
  isPipelineResolutionError,
  PipelineResolutionError,
  resolvePipeline,
  resolvePipelineId,
  tryResolvePipelineId,
} from "./pipeline-adapter.ts";

interface PipelineRow {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  type: string;
  is_active: boolean;
}

/**
 * Fake da tabela `pipelines`: aplica os `.eq()` de verdade (org + id/slug),
 * porque o recorte de org e a escolha id-vs-slug SÃO o contrato testado.
 * Conta as consultas para o caso do cache.
 */
function fakePipelines(rows: PipelineRow[], state = { queries: 0 }) {
  const supa = {
    from(table: string) {
      if (table !== "pipelines") throw new Error(`tabela inesperada: ${table}`);
      const filters: Record<string, string> = {};
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        maybeSingle: () => {
          state.queries++;
          const hit = rows.find((r) =>
            Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, string>)[k] === v)
          );
          return Promise.resolve({ data: hit ?? null, error: null });
        },
      };
      return builder;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return { supa, state };
}

// deno-lint-ignore no-explicit-any
function fakeLookupError(): any {
  return {
    from() {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }),
      };
      return builder;
    },
  };
}

const ORG = "org-res";
const UUID_CUSTOM = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ROWS: PipelineRow[] = [
  { id: "11111111-1111-4111-8111-111111111111", organization_id: ORG, slug: "whatsapp", name: "Oportunidades", type: "system", is_active: true },
  { id: UUID_CUSTOM, organization_id: ORG, slug: "giro-de-carteira", name: "Giro de Carteira", type: "custom", is_active: true },
  { id: "22222222-2222-4222-8222-222222222222", organization_id: ORG, slug: "desativado", name: "Desativado", type: "custom", is_active: false },
  { id: "33333333-3333-4333-8333-333333333333", organization_id: "outra-org", slug: "whatsapp", name: "Oportunidades", type: "system", is_active: true },
];

Deno.test("resolve por slug de funil CUSTOM — sem filtro type='system'", async () => {
  __clearPipelineResolutionCache();
  const { supa } = fakePipelines(ROWS);
  const p = await resolvePipeline(supa, ORG, "giro-de-carteira");
  assertEquals(p.id, UUID_CUSTOM);
  assertEquals(p.type, "custom");
});

Deno.test("resolve por UUID direto, com recorte de org", async () => {
  __clearPipelineResolutionCache();
  const { supa } = fakePipelines(ROWS);
  assertEquals(await resolvePipelineId(supa, ORG, UUID_CUSTOM), UUID_CUSTOM);
  // O mesmo uuid NÃO resolve para outra org — recorte multi-tenant.
  await assertRejects(
    () => resolvePipelineId(supa, "outra-org", UUID_CUSTOM),
    PipelineResolutionError,
  );
});

Deno.test("os 3 slugs históricos seguem resolvendo igual (funis semeados)", async () => {
  __clearPipelineResolutionCache();
  const { supa } = fakePipelines(ROWS);
  assertEquals(await resolvePipelineId(supa, ORG, "whatsapp"), "11111111-1111-4111-8111-111111111111");
});

Deno.test("alias legado: qualificacao → whatsapp quando não há funil com esse slug", async () => {
  __clearPipelineResolutionCache();
  const { supa } = fakePipelines(ROWS);
  assertEquals(await resolvePipelineId(supa, ORG, "qualificacao"), "11111111-1111-4111-8111-111111111111");
});

Deno.test("alias NÃO sombreia funil real: org com funil slug=qualificacao resolve para ele", async () => {
  __clearPipelineResolutionCache();
  const rows: PipelineRow[] = [
    ...ROWS,
    { id: "44444444-4444-4444-8444-444444444444", organization_id: ORG, slug: "qualificacao", name: "Qualificação própria", type: "custom", is_active: true },
  ];
  const { supa } = fakePipelines(rows);
  assertEquals(await resolvePipelineId(supa, ORG, "qualificacao"), "44444444-4444-4444-8444-444444444444");
});

Deno.test("SCRUM-641: alias legado em org SEM o funil do trio → pipeline_not_found tipado (alias resolve SÓ onde o funil existe)", async () => {
  __clearPipelineResolutionCache();
  // Org nova pós-funil-único: só o funil semeado 'vendas' — nenhum slug do trio.
  const rows: PipelineRow[] = [
    { id: "55555555-5555-4555-8555-555555555555", organization_id: "org-nova", slug: "vendas", name: "Funil de Vendas", type: "custom", is_active: true },
  ];
  const { supa } = fakePipelines(rows);
  for (const alias of ["qualificacao", "pipe_whatsapp", "pipe_confirmacao", "pipe_propostas"]) {
    __clearPipelineResolutionCache();
    const err = await assertRejects(
      () => resolvePipelineId(supa, "org-nova", alias),
      PipelineResolutionError,
    );
    assertEquals(err.code, "pipeline_not_found");
    assertEquals(err.ref, alias);
  }
  // Os slugs diretos do trio também erram tipado nessa org.
  for (const slug of ["whatsapp", "confirmacao", "propostas"]) {
    __clearPipelineResolutionCache();
    const err = await assertRejects(
      () => resolvePipelineId(supa, "org-nova", slug),
      PipelineResolutionError,
    );
    assertEquals(err.code, "pipeline_not_found");
  }
  // E o funil que a org TEM segue resolvendo.
  assertEquals(await resolvePipelineId(supa, "org-nova", "vendas"), "55555555-5555-4555-8555-555555555555");
});

Deno.test("funil inexistente → PipelineResolutionError(pipeline_not_found), nunca null", async () => {
  __clearPipelineResolutionCache();
  const { supa } = fakePipelines(ROWS);
  const err = await assertRejects(
    () => resolvePipelineId(supa, ORG, "nao-existe"),
    PipelineResolutionError,
  );
  assertEquals(err.code, "pipeline_not_found");
  assertEquals(err.orgId, ORG);
  assertEquals(err.ref, "nao-existe");
  assertEquals(isPipelineResolutionError(err), true);
});

Deno.test("funil INATIVO → PipelineResolutionError(pipeline_inactive)", async () => {
  __clearPipelineResolutionCache();
  const { supa } = fakePipelines(ROWS);
  const err = await assertRejects(
    () => resolvePipeline(supa, ORG, "desativado"),
    PipelineResolutionError,
  );
  assertEquals(err.code, "pipeline_inactive");
});

Deno.test("lookup que falha → PipelineResolutionError(pipeline_lookup_failed) — transitório distinguível", async () => {
  __clearPipelineResolutionCache();
  const err = await assertRejects(
    () => resolvePipelineId(fakeLookupError(), ORG, "whatsapp"),
    PipelineResolutionError,
  );
  assertEquals(err.code, "pipeline_lookup_failed");
});

Deno.test("tryResolvePipelineId degrada erro DE RESOLUÇÃO para null; erro alheio sobe", async () => {
  __clearPipelineResolutionCache();
  const { supa } = fakePipelines(ROWS);
  assertEquals(await tryResolvePipelineId(supa, ORG, "nao-existe"), null);
  assertEquals(await tryResolvePipelineId(fakeLookupError(), ORG, "whatsapp"), null);
  // deno-lint-ignore no-explicit-any
  const quebrado: any = { from() { throw new Error("bug alheio"); } };
  await assertRejects(() => tryResolvePipelineId(quebrado, ORG, "whatsapp"), Error, "bug alheio");
});

Deno.test("cache por org: id, slug e alias batem no mesmo registro sem nova query", async () => {
  __clearPipelineResolutionCache();
  const { supa, state } = fakePipelines(ROWS);
  await resolvePipelineId(supa, ORG, "qualificacao"); // miss slug direto + hit alias = 2 queries
  const before = state.queries;
  await resolvePipelineId(supa, ORG, "qualificacao");
  await resolvePipelineId(supa, ORG, "whatsapp");
  await resolvePipelineId(supa, ORG, "11111111-1111-4111-8111-111111111111");
  assertEquals(state.queries, before);
});
