import { withErrorBoundary } from "../_shared/error-boundary.ts";
/**
 * Stage Role Classifier (#991 + U4, ADR-0017 §1 — padrão ADR-0006).
 *
 * Sugere `stage_role` para etapas ungovernadas de DOIS cadernos de etapa:
 * SISTEMA `pipeline_stages` (chave fora do mapa de sistema do #990) E CUSTOM
 * `custom_pipeline_stages` (as 22 orgs de funil custom, U4). Predicado idêntico
 * nos dois: role 'open', sem sugestão pendente e nunca revisadas. O plano é
 * escrito de volta na MESMA tabela de onde a linha veio (U1 espelhou as colunas
 * de sugestão em custom_pipeline_stages — payload table-agnostic). Duas passadas:
 *
 *   1. Determinística — mapa de sinônimos pt-BR pelo NOME + flags
 *      is_final_positive/negative como sinal fraco (fallback). Nomes óbvios
 *      ("Fechado", "Recomprou", "Reunião marcada") resolvem aqui, sem IA.
 *   2. IA (opcional, resíduo) — LLM classifica os nomes não-óbvios num dos
 *      5 roles, temperature 0, mesma mecânica do classify-followup-stages.
 *
 * Aplicação (ADR-0017 §1 — won/lost = dinheiro = confirmação humana):
 *   · meeting_booked / meeting_held → AUTO-APLICA (update stage_role direto)
 *   · won / lost → grava `suggested_stage_role` (fila da tela master
 *     /master/stage-roles). NUNCA aplica.
 *
 * Backfill das ~30 orgs: body {"all_orgs": true} — uma passada. On-demand:
 * {"organization_id": "..."}. {"dry_run": true} devolve o plano sem escrever;
 * {"use_ai": false} pula o LLM.
 *
 * Auth: x-cron-secret (service-side only, como classify-followup-stages).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { OpenRouterClient } from "../agent-message/openrouter-client.ts";
import {
  planStageRoleSuggestions,
  type StagePlanItem,
  type StageToClassify,
  type SuggestableStageRole,
} from "../_shared/metrics/stage-role-classifier.ts";
import {
  buildStageRoleUpdate,
  type StageSourceTable,
} from "../_shared/metrics/stage-role-writeback.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

/**
 * ── won/lost saíram daqui (B2d) ───────────────────────────────────────────
 * A etapa deixou de decidir ganho e perda: quem decide é o desfecho do
 * negócio, e é de lá que todas as métricas leem
 * (migration `a_coluna_deixa_de_decidir`).
 *
 * Continuar sugerindo won/lost encheria a fila do master com 163 itens que,
 * ao serem aprovados, REATIVARIAM o registro de venda por arrastar naquela
 * etapa — contra o modelo que o resto do sistema segue. Sugestão que só pode
 * causar dano não é sugestão.
 *
 * Os papéis de REUNIÃO ficam e seguem auto-aplicando: `agendado` e
 * `compareceu` são posição no funil, não dinheiro, e a agenda depende deles.
 */
const SUGGESTABLE_ROLES: SuggestableStageRole[] = [
  "meeting_booked",
  "meeting_held",
];

interface StageRow {
  id: string;
  organization_id: string;
  pipeline_type: string;
  stage_key: string;
  name: string;
  position: number;
  is_final_positive: boolean | null;
  is_final_negative: boolean | null;
  /** Caderno de origem — decide para onde o plano volta a ser escrito. */
  source_table: StageSourceTable;
}

/** Custom stages não têm coluna pipeline_type; nunca são de sistema. Este
 * sentinela garante isSystemStageKey()=false (não existe funil de sistema
 * "custom"), então toda etapa custom é classificada — nenhuma é pulada. */
const CUSTOM_PIPELINE_TYPE_SENTINEL = "custom";

function buildPrompt(stages: StageRow[]): string {
  const lines = stages.map((s) =>
    `- id=${s.id} pipe=${s.pipeline_type} nome="${s.name}" posição=${s.position}` +
    (s.is_final_positive ? " [flag: final positivo]" : "") +
    (s.is_final_negative ? " [flag: final negativo]" : ""),
  );
  return [
    "Você classifica etapas de funil de vendas B2B (CRM, pt-BR) em papéis semânticos para métricas.",
    "Para CADA etapa, escolha UM papel pelo NOME:",
    "- meeting_booked: reunião/call/visita marcada ou aguardando confirmação",
    "- meeting_held: reunião/call/visita realizada, lead compareceu",
    "- open: qualquer outra coisa — incluindo etapa de VENDA GANHA ou PERDIDA",
    "IMPORTANTE: etapa de venda ganha/perdida é `open`. O sistema decide ganho e",
    "perda pelo desfecho do NEGÓCIO, não pela etapa — a etapa só dá nome à coluna.",
    "As flags [final positivo/negativo] são sinal fraco — o NOME decide. Na dúvida, use open.",
    "",
    "Etapas:",
    ...lines,
    "",
    'Responda APENAS um JSON objeto {"<id>":"<papel>", ...}. Sem texto extra.',
  ].join("\n");
}

/** Extrai o JSON do LLM e mantém só roles sugeríveis válidos ('open' descarta). */
function parseAiClassification(
  raw: string,
  validIds: Set<string>,
): Record<string, SuggestableStageRole | null> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return {};
  }
  const out: Record<string, SuggestableStageRole | null> = {};
  for (const [id, role] of Object.entries(parsed)) {
    if (!validIds.has(id)) continue;
    if ((SUGGESTABLE_ROLES as string[]).includes(role)) {
      out[id] = role as SuggestableStageRole;
    }
  }
  return out;
}

interface TableCounts {
  examined: number;
  auto_applied: number;
  queued_review: number;
}

function emptyTableCounts(): TableCounts {
  return { examined: 0, auto_applied: 0, queued_review: 0 };
}

interface OrgResult {
  organization_id: string;
  examined: number;
  auto_applied: number;
  queued_review: number;
  unresolved: number;
  skipped_system: number;
  /** Quebra system vs custom — o operador vê de onde veio cada sugestão. */
  by_table: Record<StageSourceTable, TableCounts>;
  items: (StagePlanItem & {
    stage_key: string;
    name: string;
    source_table: StageSourceTable;
  })[];
}

Deno.serve(withErrorBoundary("classify-stage-roles", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const organizationId = body.organization_id as string | undefined;
  const allOrgs = body.all_orgs === true;
  const dryRun = body.dry_run === true;
  const useAi = body.use_ai !== false;

  if (!organizationId && !allOrgs) {
    return json({ error: "organization_id or all_orgs required" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Candidatas (predicado IDÊNTICO nas duas tabelas): ativas, sem role
  // definido, sem sugestão pendente e nunca revisadas (reviewed_at é o marcador
  // anti-re-sugestão de etapa dispensada). Em pipeline_stages, etapas de
  // sistema entram no fetch mas saem no plano (isSystemStageKey) — role delas é
  // governado pelo mapa SQL do #990, nunca pelo classifier. Etapas custom nunca
  // são de sistema (tabela distinta, sem mapa determinístico).

  // SISTEMA — pipeline_stages (carrega pipeline_type real).
  let systemQuery = supabase
    .from("pipeline_stages")
    .select(
      "id, organization_id, pipeline_type, stage_key, name, position, is_final_positive, is_final_negative",
    )
    .eq("is_active", true)
    .eq("stage_role", "open")
    .is("suggested_stage_role", null)
    .is("stage_role_reviewed_at", null);
  if (!allOrgs) systemQuery = systemQuery.eq("organization_id", organizationId!);

  // CUSTOM — custom_pipeline_stages (sem coluna pipeline_type; U1 espelhou role
  // + colunas de sugestão). U4: é o que traz as 22 orgs de funil custom.
  let customQuery = supabase
    .from("custom_pipeline_stages")
    .select(
      "id, organization_id, stage_key, name, position, is_final_positive, is_final_negative",
    )
    .eq("is_active", true)
    .eq("stage_role", "open")
    .is("suggested_stage_role", null)
    .is("stage_role_reviewed_at", null);
  if (!allOrgs) customQuery = customQuery.eq("organization_id", organizationId!);

  const [systemRes, customRes] = await Promise.all([systemQuery, customQuery]);
  if (systemRes.error) return json({ error: systemRes.error.message }, 500);
  if (customRes.error) return json({ error: customRes.error.message }, 500);

  const stageRows: StageRow[] = [
    ...((systemRes.data ?? []) as Omit<StageRow, "source_table">[]).map((r) => ({
      ...r,
      source_table: "pipeline_stages" as StageSourceTable,
    })),
    ...((customRes.data ?? []) as Omit<StageRow, "source_table" | "pipeline_type">[]).map((r) => ({
      ...r,
      pipeline_type: CUSTOM_PIPELINE_TYPE_SENTINEL,
      source_table: "custom_pipeline_stages" as StageSourceTable,
    })),
  ];

  const byOrg = new Map<string, StageRow[]>();
  for (const row of stageRows) {
    const list = byOrg.get(row.organization_id);
    if (list) list.push(row);
    else byOrg.set(row.organization_id, [row]);
  }

  const openRouter = useAi && OPENROUTER_API_KEY ? new OpenRouterClient(OPENROUTER_API_KEY) : null;
  const nowIso = new Date().toISOString();
  const results: OrgResult[] = [];
  let totalAutoApplied = 0;
  let totalQueued = 0;
  const totalsByTable: Record<StageSourceTable, TableCounts> = {
    pipeline_stages: emptyTableCounts(),
    custom_pipeline_stages: emptyTableCounts(),
  };

  for (const [orgId, orgRows] of byOrg) {
    const stages: StageToClassify[] = orgRows.map((r) => ({
      id: r.id,
      pipelineType: r.pipeline_type,
      stageKey: r.stage_key,
      name: r.name,
      isFinalPositive: r.is_final_positive ?? false,
      isFinalNegative: r.is_final_negative ?? false,
    }));

    // Passada 1 — determinística (nome + flag).
    let plan = planStageRoleSuggestions(stages);

    // Passada 2 — IA só pro resíduo não-óbvio.
    if (plan.unresolved.length > 0 && openRouter) {
      const residueRows = orgRows.filter((r) => plan.unresolved.some((u) => u.id === r.id));
      try {
        const response = await openRouter.chat({
          model: Deno.env.get("OPENROUTER_DEFAULT_MODEL") || "openai/gpt-4.1-mini",
          messages: [{ role: "user", content: buildPrompt(residueRows) }],
          max_tokens: 1200,
          temperature: 0,
        });
        const raw = response?.choices?.[0]?.message?.content ?? "";
        const aiClassification = parseAiClassification(
          raw,
          new Set(residueRows.map((r) => r.id)),
        );
        plan = planStageRoleSuggestions(stages, aiClassification);
      } catch (err) {
        // IA indisponível não bloqueia a passada determinística.
        console.error(`classify-stage-roles: AI pass failed for org ${orgId}:`, err);
      }
    }

    const rowById = new Map(orgRows.map((r) => [r.id, r]));
    const byTable: Record<StageSourceTable, TableCounts> = {
      pipeline_stages: emptyTableCounts(),
      custom_pipeline_stages: emptyTableCounts(),
    };
    for (const r of orgRows) byTable[r.source_table].examined++;

    const orgResult: OrgResult = {
      organization_id: orgId,
      examined: stages.length,
      auto_applied: 0,
      queued_review: 0,
      unresolved: plan.unresolved.length,
      skipped_system: plan.skippedSystem,
      by_table: byTable,
      items: plan.items.map((i) => ({
        ...i,
        stage_key: rowById.get(i.id)?.stage_key ?? "",
        name: rowById.get(i.id)?.name ?? "",
        source_table: rowById.get(i.id)?.source_table ?? "pipeline_stages",
      })),
    };

    for (const item of plan.items) {
      // Invariante ADR-0017 §1: won/lost jamais auto-aplicam. A decisão vem de
      // decideStageRoleAction (testada em unit); buildStageRoleUpdate reflete-a
      // 1:1 (won/lost → suggested_stage_role; meeting_* → stage_role). Payload
      // idêntico nas duas tabelas (U1). O write volta pra tabela de origem.
      const row = rowById.get(item.id);
      const table: StageSourceTable = row?.source_table ?? "pipeline_stages";
      const update = buildStageRoleUpdate(item, nowIso);

      if (!dryRun) {
        const { error: updateError } = await supabase
          .from(table)
          .update(update)
          .eq("id", item.id)
          .eq("stage_role", "open"); // guarda: não sobrescreve role definido no meio-tempo
        if (updateError) {
          console.error(`classify-stage-roles: update failed for stage ${item.id} (${table}):`, updateError.message);
          continue;
        }
      }

      if (item.action === "auto_apply") {
        orgResult.auto_applied++;
        byTable[table].auto_applied++;
      } else {
        orgResult.queued_review++;
        byTable[table].queued_review++;
      }
    }

    totalAutoApplied += orgResult.auto_applied;
    totalQueued += orgResult.queued_review;
    for (const t of ["pipeline_stages", "custom_pipeline_stages"] as StageSourceTable[]) {
      totalsByTable[t].examined += byTable[t].examined;
      totalsByTable[t].auto_applied += byTable[t].auto_applied;
      totalsByTable[t].queued_review += byTable[t].queued_review;
    }
    results.push(orgResult);
  }

  return json({
    dry_run: dryRun,
    ai_enabled: !!openRouter,
    orgs: results.length,
    auto_applied: totalAutoApplied,
    queued_review: totalQueued,
    by_table: totalsByTable,
    results,
  });
}));
