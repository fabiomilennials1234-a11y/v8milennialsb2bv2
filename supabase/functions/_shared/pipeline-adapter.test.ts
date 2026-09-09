/**
 * Behaviour tests for resolveActiveStageKey — the ghost-stage ingest guard.
 *
 * External ingest (Make/n8n/Meta) sends a stage slug as a fixed string. If that
 * slug was deactivated/renamed in the org, the lead must NOT land in it (it would
 * be invisible in the Kanban). The resolver coerces the target to a real active
 * stage. See pipeline-adapter.ts.
 *
 * SCRUM-623: o resolver passou a (1) resolver o funil por id/slug em `pipelines`
 * (qualquer funil, sem `type='system'`) e (2) ler as etapas por `pipeline_id`.
 * O fake abaixo serve as duas tabelas.
 */
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { __clearPipelineResolutionCache, resolveActiveStageKey } from "./pipeline-adapter.ts";

/**
 * Fake do query builder cobrindo o caminho novo: `pipelines` termina em
 * `.maybeSingle()` e `pipeline_stages` é aguardável depois de `.order()`.
 */
// deno-lint-ignore no-explicit-any
function fakeSupabase(opts: {
  // deno-lint-ignore no-explicit-any
  pipeline?: Record<string, any> | null;
  pipelineError?: unknown;
  // deno-lint-ignore no-explicit-any
  stages?: any[];
  stagesError?: unknown;
  // deno-lint-ignore no-explicit-any
}): any {
  return {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            opts.pipelineError
              ? { data: null, error: opts.pipelineError }
              : {
                data: opts.pipeline === null ? null : (opts.pipeline ?? PIPELINE_ROW),
                error: null,
              },
          ),
        order: () =>
          Promise.resolve(
            opts.stagesError
              ? { data: null, error: opts.stagesError }
              : { data: opts.stages ?? null, error: null },
          ),
      };
      if (table !== "pipelines" && table !== "pipeline_stages") {
        throw new Error(`tabela inesperada no resolver: ${table}`);
      }
      return builder;
    },
  };
}

const PIPELINE_ROW = { id: "pipe-1", slug: "whatsapp", name: "Oportunidades", type: "system", is_active: true };

const ACTIVE = [
  { stage_key: "novo_lead", position: 0 },
  { stage_key: "abordado", position: 1 },
  { stage_key: "agendado", position: 4 },
];

// O cache module-level é por org:ref — limpar entre casos evita herdar o funil
// resolvido pelo caso anterior.
function fresh(): void {
  __clearPipelineResolutionCache();
}

Deno.test("requested stage that is active → returned as-is", async () => {
  fresh();
  const supa = fakeSupabase({ stages: ACTIVE });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp", "abordado");
  assertEquals(got, "abordado");
});

Deno.test("requested stage NOT active → remapped to first active (min position)", async () => {
  fresh();
  const supa = fakeSupabase({ stages: ACTIVE });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp", "novo");
  assertEquals(got, "novo_lead");
});

Deno.test("no requested stage → first active stage", async () => {
  fresh();
  const supa = fakeSupabase({ stages: ACTIVE });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp");
  assertEquals(got, "novo_lead");
});

Deno.test("org has no active stages → null (caller falls back)", async () => {
  fresh();
  const supa = fakeSupabase({ stages: [] });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp", "novo");
  assertEquals(got, null);
});

Deno.test("stage query error → trusts the requested value (never drops the lead)", async () => {
  fresh();
  const supa = fakeSupabase({ stagesError: { message: "boom" } });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp", "abordado");
  assertEquals(got, "abordado");
});

Deno.test("SCRUM-623: funil CUSTOM resolve igual — o guard não é mais system-only", async () => {
  fresh();
  const supa = fakeSupabase({
    pipeline: { id: "pipe-c", slug: "giro-de-carteira", name: "Giro", type: "custom", is_active: true },
    stages: [{ stage_key: "primeira_etapa", position: 0 }],
  });
  const got = await resolveActiveStageKey(supa, "org-1", "giro-de-carteira", "etapa_fantasma");
  assertEquals(got, "primeira_etapa");
});

Deno.test("SCRUM-623: funil inexistente → degrada para o requested (caminho de ingest não estoura)", async () => {
  fresh();
  const supa = fakeSupabase({ pipeline: null });
  const got = await resolveActiveStageKey(supa, "org-1", "nao-existe", "abordado");
  assertEquals(got, "abordado");
});

Deno.test("SCRUM-623: lookup do funil falhou → degrada para o requested", async () => {
  fresh();
  const supa = fakeSupabase({ pipelineError: { message: "boom" } });
  const got = await resolveActiveStageKey(supa, "org-1", "whatsapp", "abordado");
  assertEquals(got, "abordado");
});
