/* eslint-disable @typescript-eslint/no-explicit-any -- Dublê de teste; mesma justificativa dos pipeline-adapter-*.test.ts. */
/**
 * Contrato do destino de porta (SCRUM-641, D4).
 *
 * O que se prova:
 *   1. destino PREFERIDO (slug histórico) vale onde existe — org antiga
 *      intocada, etapa literal preservada;
 *   2. org sem o preferido → funil PADRÃO, reunião ancorada pela etapa de
 *      papel `meeting_booked` (nunca por slug);
 *   3. funil padrão sem papel de reunião → 1ª etapa ativa (fallback definido);
 *   4. org sem funil padrão → null (lead sem card, decisão do chamador);
 *   5. lead comum: fallback = funil padrão + 1ª etapa ativa.
 */
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { __clearPipelineResolutionCache } from "./pipeline-adapter.ts";
import {
  resolveLeadDestination,
  resolveMeetingDestination,
} from "./pipeline-destination.ts";

interface PipelineRow {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  type: string;
  is_active: boolean;
}
interface StageRow {
  organization_id: string;
  pipeline_id: string;
  stage_key: string;
  position: number;
  is_active: boolean;
  stage_role: string;
}

function fakeSupa(opts: {
  pipelines: PipelineRow[];
  stages: StageRow[];
  defaultPipelineId: string | null;
}): any {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: unknown) => {
          filters[c] = v;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => {
          if (table === "organizations") {
            return Promise.resolve({ data: { default_pipeline_id: opts.defaultPipelineId }, error: null });
          }
          if (table === "pipelines") {
            const hit = opts.pipelines.find((r) =>
              Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
            );
            return Promise.resolve({ data: hit ?? null, error: null });
          }
          throw new Error(`maybeSingle inesperado: ${table}`);
        },
        then: (resolve: (v: unknown) => unknown) => {
          // await direto no builder (caminho das listas de etapas)
          if (table !== "pipeline_stages") throw new Error(`lista inesperada: ${table}`);
          const rows = opts.stages
            .filter((r) =>
              Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
            )
            .sort((a, b) => a.position - b.position);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

const ORG = "org-641";
const TRIO_CONF = "11111111-1111-4111-8111-111111111111";
const VENDAS = "22222222-2222-4222-8222-222222222222";

const ORG_ANTIGA = {
  pipelines: [
    { id: TRIO_CONF, organization_id: ORG, slug: "confirmacao", name: "Agendamentos", type: "system", is_active: true },
  ],
  stages: [
    { organization_id: ORG, pipeline_id: TRIO_CONF, stage_key: "reuniao_marcada", position: 0, is_active: true, stage_role: "meeting_booked" },
  ],
  defaultPipelineId: TRIO_CONF,
};

const ORG_NOVA = {
  pipelines: [
    { id: VENDAS, organization_id: ORG, slug: "vendas", name: "Funil de Vendas", type: "custom", is_active: true },
  ],
  stages: [
    { organization_id: ORG, pipeline_id: VENDAS, stage_key: "novo", position: 0, is_active: true, stage_role: "open" },
    { organization_id: ORG, pipeline_id: VENDAS, stage_key: "em_conversa", position: 1, is_active: true, stage_role: "open" },
    { organization_id: ORG, pipeline_id: VENDAS, stage_key: "reuniao_marcada", position: 2, is_active: true, stage_role: "meeting_booked" },
    { organization_id: ORG, pipeline_id: VENDAS, stage_key: "ganhou", position: 4, is_active: true, stage_role: "won" },
  ],
  defaultPipelineId: VENDAS,
};

Deno.test("org antiga: preferido 'confirmacao' vale como sempre — etapa literal, sem fallback", async () => {
  __clearPipelineResolutionCache();
  const supa = fakeSupa(ORG_ANTIGA);
  const dest = await resolveMeetingDestination(supa, ORG, { ref: "confirmacao", stageKey: "reuniao_marcada" });
  assertEquals(dest, { ref: "confirmacao", stageKey: "reuniao_marcada", usedDefaultPipeline: false });
});

Deno.test("org nova (sem trio): reunião cai no funil padrão pela etapa de PAPEL meeting_booked", async () => {
  __clearPipelineResolutionCache();
  const supa = fakeSupa(ORG_NOVA);
  const dest = await resolveMeetingDestination(supa, ORG, { ref: "confirmacao", stageKey: "reuniao_marcada" });
  assertEquals(dest, { ref: VENDAS, stageKey: "reuniao_marcada", usedDefaultPipeline: true });
});

Deno.test("funil padrão SEM papel de reunião: 1ª etapa ativa (comportamento definido, não silêncio)", async () => {
  __clearPipelineResolutionCache();
  const supa = fakeSupa({
    ...ORG_NOVA,
    stages: ORG_NOVA.stages.filter((s) => s.stage_role !== "meeting_booked"),
  });
  const dest = await resolveMeetingDestination(supa, ORG, { ref: "confirmacao", stageKey: "reuniao_marcada" });
  assertEquals(dest, { ref: VENDAS, stageKey: "novo", usedDefaultPipeline: true });
});

Deno.test("org sem funil padrão e sem o preferido → null (lead sem card, decisão do chamador)", async () => {
  __clearPipelineResolutionCache();
  const supa = fakeSupa({ pipelines: [], stages: [], defaultPipelineId: null });
  assertEquals(await resolveMeetingDestination(supa, ORG, { ref: "confirmacao", stageKey: "reuniao_marcada" }), null);
  assertEquals(await resolveLeadDestination(supa, ORG, { ref: "whatsapp" }), null);
});

Deno.test("lead comum em org nova: funil padrão + 1ª etapa ativa", async () => {
  __clearPipelineResolutionCache();
  const supa = fakeSupa(ORG_NOVA);
  const dest = await resolveLeadDestination(supa, ORG, { ref: "whatsapp" });
  assertEquals(dest, { ref: VENDAS, stageKey: "novo", usedDefaultPipeline: true });
});

Deno.test("lead comum em org antiga com 'whatsapp': preferido vale, 1ª etapa ativa do próprio funil", async () => {
  __clearPipelineResolutionCache();
  const WPP = "33333333-3333-4333-8333-333333333333";
  const supa = fakeSupa({
    pipelines: [
      { id: WPP, organization_id: ORG, slug: "whatsapp", name: "Oportunidades", type: "system", is_active: true },
    ],
    stages: [
      { organization_id: ORG, pipeline_id: WPP, stage_key: "novo", position: 0, is_active: true, stage_role: "open" },
    ],
    defaultPipelineId: WPP,
  });
  const dest = await resolveLeadDestination(supa, ORG, { ref: "whatsapp" });
  assertEquals(dest, { ref: "whatsapp", stageKey: "novo", usedDefaultPipeline: false });
});
