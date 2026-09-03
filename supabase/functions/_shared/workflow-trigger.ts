/**
 * Workflow Trigger — central module for firing workflow triggers from Edge Functions
 *
 * Used by edge functions that need to fire triggers not handled by PG triggers:
 * - lead_replied (from agent-message)
 * - lead_no_reply (from pg_cron check)
 * - meeting_not_confirmed (from pg_cron check)
 * - followup_overdue (from pg_cron check)
 * - webhook_received (from process-webhook-deliveries)
 * - cron (from process-workflow-executions cron_triggers mode)
 * - stage_changed (migrated from frontend)
 *
 * PG triggers handle: lead_created, tag_added, score_reached, lead_assigned,
 * field_changed, meeting_confirmed, proposal_accepted, proposal_lost,
 * campaign_status_changed
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeTriggerDedupKey } from "./workflow-trigger-dedup.ts";

/**
 * Forma das linhas que `fireTrigger` lê de `workflows`.
 *
 * `definition` é opcional de propósito: só entra no `select` quando a origem é o
 * copilot (é o único caso que precisa inspecionar os nós), e o guard de origem
 * já trata a ausência.
 */
type TriggerWorkflowRow = {
  id: string;
  trigger_config: Record<string, unknown>;
  definition?: { nodes: { type: string }[] } | null;
};

interface FireTriggerParams {
  supabase: SupabaseClient;
  organizationId: string;
  triggerType: string;
  leadId: string;
  /**
   * O Negócio que disparou — `pipeline_entries.id`.
   *
   * Opcional porque a maioria dos gatilhos é da PESSOA (`lead_created`,
   * `tag_added`) e ali não há negócio a declarar. Quem vem do funil manda: os
   * dois gatilhos de etapa passaram a pôr `pipeline_entry_id` dentro do
   * `context`, e é de lá que este campo é lido quando o chamador não o passa
   * explicitamente — a borda HTTP (`mode: fire_trigger`) só repassa o context.
   */
  entryId?: string | null;
  dealId?: string | null;
  context?: Record<string, unknown>;
  source?: string;
}

/**
 * O papel da etapa de destino: `won`, `lost` ou outra coisa.
 *
 * É daqui que saem os gatilhos "Negócio ganho" e "Negócio perdido". Eles NÃO
 * leem `deals.won`: medido em prod (2026-08-25), 34.662 dos 34.980 negócios têm
 * `won = false` porque o backfill carimbou assim tudo que não estava ganho — a
 * coluna responde "não foi ganho", não "foi perdido". Quem sabe a verdade é a
 * POSIÇÃO (ADR-0023 §5), e ganhar/perder é chegar na etapa terminal
 * (ADR-0023 §4, §5). É o mesmo critério que o card do Negócio usa para desenhar
 * os botões "Ganhou" e "Perdeu".
 */
async function resolveStageRole(
  supabase: SupabaseClient,
  organizationId: string,
  ctx: Record<string, unknown>,
): Promise<string | null> {
  // Caminho canônico (SCRUM-627): o contexto unificado carrega o UUID da etapa
  // (`pipeline_stages.id` — tabela ÚNICA pós-20270906001000, cobre sistema e
  // custom). Resolve direto, sem depender de slug nem de qual funil é.
  const stageId = asUuidOrNull(ctx.stage_id);
  if (stageId) {
    const { data } = await supabase
      .from("pipeline_stages")
      .select("stage_role, organization_id")
      .eq("id", stageId)
      .maybeSingle();
    if (data && data.organization_id === organizationId) {
      return (data.stage_role as string) ?? null;
    }
  }

  const toStage = typeof ctx.to_stage === "string" ? ctx.to_stage : null;
  if (!toStage) return null;

  const pipeType = typeof ctx.pipe_type === "string" ? ctx.pipe_type : null;
  if (pipeType) {
    const { data } = await supabase
      .from("pipeline_stages")
      .select("stage_role")
      .eq("organization_id", organizationId)
      .eq("pipeline_type", pipeType)
      .eq("stage_key", toStage)
      .eq("is_active", true)
      .maybeSingle();
    return (data?.stage_role as string) ?? null;
  }

  const pipelineId = typeof ctx.pipeline_id === "string" ? ctx.pipeline_id : null;
  if (pipelineId) {
    const { data } = await supabase
      .from("custom_pipeline_stages")
      .select("stage_role")
      .eq("pipeline_id", pipelineId)
      .eq("stage_key", toStage)
      .maybeSingle();
    return (data?.stage_role as string) ?? null;
  }

  return null;
}

/**
 * `context` é jsonb livre — nada valida a forma na escrita, e o gatilho de banco
 * pode mandar `null` num `jsonb_build_object`. Só string não-vazia vira id; o
 * resto vira `null` em vez de viajar como `"null"` até um `.eq()` que não casa
 * com nada.
 */
function asUuidOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v && v !== "null" ? v : null;
}

/**
 * Normaliza `trigger_config.pipeline_ids` (jsonb livre — nada valida a forma
 * na escrita) para uma lista de uuids utilizável. Descarta não-strings, apara
 * espaço e remove vazios.
 */
export function normalizePipelineIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

/**
 * Um workflow de `lead_replied` só precisa do lookup de posição se filtrar por
 * funil OU por etapa. As duas listas vêm da MESMA leitura de
 * `pipeline_entries`, então uma guarda só decide se a query acontece.
 */
function usesLeadPositionFilter(triggerConfig: Record<string, unknown> | null | undefined): boolean {
  const cfg = triggerConfig || {};
  return (
    normalizePipelineIds(cfg.pipeline_ids).length > 0 ||
    normalizePipelineIds(cfg.stage_ids).length > 0
  );
}

/**
 * Funis (`pipelines.id`) em que o lead tem entrada.
 *
 * `pipeline_entries` é a tabela canônica e sozinha cobre os dois tipos de
 * funil: as views `pipe_*` são projeções dela, e os funis custom são
 * espelhados nela por trigger. Medido em PROD 2026-08-11: 0 entries órfãs e 0
 * `custom_pipe_entries` sem par (de 16.233) — ler só esta tabela não perde nada.
 *
 * Sem `.limit()` de propósito: a constraint UNIQUE (pipeline_id, lead_id) limita
 * o retorno a 1 linha por funil da org (máximo medido em PROD: 21), muito abaixo
 * do teto de 1000 do PostgREST que corta select sem limite em silêncio.
 *
 * Devolve `null` quando a leitura falha — o matcher trata `null` como
 * fail-closed. O filtro por `organization_id` é explícito e obrigatório: quem
 * chama é service_role, que BYPASSA a RLS de `pipeline_entries`.
 */
async function loadLeadPosition(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<{ pipelines: string[]; stages: (string | null)[] } | null> {
  const { data, error } = await supabase
    .from("pipeline_entries")
    .select("pipeline_id, stage_id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId);

  if (error) {
    console.warn("[workflow-trigger] Falha ao ler a posição do lead:", error.message);
    return null;
  }
  const rows = (data ?? []) as { pipeline_id: string; stage_id: string | null }[];
  return {
    pipelines: rows.map((row) => String(row.pipeline_id)),
    // `stage_id` nulo entra na lista como nulo, em vez de ser filtrado: o
    // matcher precisa distinguir "card sem etapa" (não casa nada) de "leitura
    // falhou" (fail-closed). Medido em PROD: 41 das 48.171 entradas.
    stages: rows.map((row) => (row.stage_id == null ? null : String(row.stage_id))),
  };
}

/**
 * Existe algum workflow ativo desse trigger na org?
 *
 * Guarda barata para caminhos quentes: o inbound do WhatsApp passa por aqui a
 * cada mensagem, e sem esta checagem pagaríamos um lookup de lead por mensagem
 * em toda a frota. Em PROD hoje 42 de 99 orgs têm algum workflow ativo.
 */
export async function hasActiveWorkflowsForTrigger(
  supabase: SupabaseClient,
  organizationId: string,
  triggerType: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("trigger_type", triggerType)
    .eq("is_active", true)
    .limit(1);

  if (error) {
    console.warn("[workflow-trigger] Falha ao checar workflows ativos:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Finds active workflows matching the trigger type, validates trigger_config,
 * and creates workflow_execution records.
 *
 * Returns the number of executions created.
 */
export async function fireTrigger(params: FireTriggerParams): Promise<number> {
  const { supabase, organizationId, triggerType, leadId, context, source } = params;

  /**
   * ── O SUJEITO ────────────────────────────────────────────────────────────
   * Parâmetro explícito primeiro; `context` como fonte secundária porque a
   * borda HTTP (`process-workflow-executions`, `mode: fire_trigger`) recebe o
   * corpo montado pelo gatilho de banco e só repassa `context` adiante. Sem
   * essa segunda leitura o sujeito morreria exatamente no caminho que hoje
   * produz 85 dos 130 workflows ativos.
   */
  const ctxObj = (context ?? {}) as Record<string, unknown>;
  const entryId = params.entryId ?? asUuidOrNull(ctxObj.pipeline_entry_id);
  const dealId = params.dealId ?? asUuidOrNull(ctxObj.deal_id);

  /**
   * ── Gatilhos derivados: "Negócio ganho" e "Negócio perdido" ─────────────
   * Ganhar e perder são MOVIMENTOS para a etapa terminal (ADR-0023 §4/§5), e
   * por isso o fato já chega aqui como `stage_changed`. Um gatilho próprio em
   * `deals.won` leria uma coluna que o backfill deixou mentindo (34.662 linhas
   * com `won = false` que ninguém perdeu) e ainda seria cego aos 26% de cards
   * sem linha em `deals`.
   *
   * Roda ANTES do corpo, e não no fim: o corpo tem quatro saídas antecipadas
   * (nenhum workflow, nenhum casou, todos deduplicados, insert falhou) e em
   * três delas o negócio foi ganho do mesmo jeito. Derivar no fim faria
   * "Negócio ganho" depender de existir um workflow de `stage_changed` — que é
   * exatamente o vínculo que este gatilho existe para não ter.
   *
   * Sem recursão: só `stage_changed` deriva, e o derivado nunca é `stage_changed`.
   */
  if (triggerType === "stage_changed") {
    try {
      const role = await resolveStageRole(supabase, organizationId, ctxObj);
      const derivado = role === "won" ? "deal_won" : role === "lost" ? "deal_lost" : null;
      if (derivado) {
        await fireTrigger({
          ...params,
          triggerType: derivado,
          entryId,
          dealId,
          context: { ...ctxObj, trigger: derivado, stage_role: role },
        });
      }
    } catch (err) {
      // Derivado que falha não pode derrubar o `stage_changed` que o originou.
      console.warn("[workflow-trigger] falha ao derivar deal_won/deal_lost:", err);
    }
  }

  try {
    // `selectFields` é uma UNIÃO de dois literais, e o parser de tipos do
    // postgrest-js não a atravessa: devolve `ParserError`, a linha vira um tipo
    // opaco e cada `.filter`/`.map` abaixo virava erro de sobrecarga — 5 dos 8
    // erros que a #1343 contou. A string enviada ao servidor continua
    // condicional, como sempre foi (`definition` só é buscada quando a origem é
    // o copilot); só a leitura do resultado passa a declarar a forma real.
    const selectFields = source === "copilot" ? "id, trigger_config, definition" : "id, trigger_config";
    const { data, error } = await supabase
      .from("workflows")
      .select(selectFields)
      .eq("organization_id", organizationId)
      .eq("trigger_type", triggerType)
      .eq("is_active", true);

    if (error || !data?.length) return 0;
    // Asserção, e não `.returns<>()`: aquele é método de runtime do builder, e
    // acrescentar chamada num módulo que 78 funções importam para corrigir tipo
    // é preço que não se paga (quebrou dublê de teste em `whatsapp-helpers`).
    const workflows = data as unknown as TriggerWorkflowRow[];

    // ── Contexto de MATCHING ──
    // O filtro por funil do `lead_replied` precisa saber em quais funis o lead
    // está — informação que não vem no evento. Buscamos sob demanda: só quando
    // algum workflow candidato realmente configurou o filtro. Assim o inbound
    // da esmagadora maioria das orgs não paga query nenhuma.
    //
    // Esta lista PRECISA entrar no `context` gravado em `workflow_executions`:
    // `process-workflow-executions` relê o context persistido e roda
    // `matchesTriggerConfig` DE NOVO antes de executar. Sem os funis ali, o
    // fail-closed do matcher reprova tudo — o filtro vira no-op em 100% dos
    // casos, com `error: "Skipped: trigger conditions not met"`.
    //
    // O medo de mexer na chave de dedup era legítimo (os funis do lead mudam
    // com o tempo, e isso a tornaria instável) mas não se aplica: `context:` e
    // `payload:` já são expressões separadas na montagem da execução, e só a
    // primeira leva os funis. A chave sai byte-a-byte igual.
    //
    // `lead_replied` é o primeiro trigger cujo matcher depende de um insumo que
    // não vem no evento — os outros só leem campos que o próprio evento traz,
    // e para eles a revalidação sempre foi idempotente.
    let matchContext: Record<string, unknown> = context || {};
    if (triggerType === "lead_replied" && leadId && workflows.some((w) => usesLeadPositionFilter(w.trigger_config))) {
      const posicao = await loadLeadPosition(supabase, organizationId, leadId);
      matchContext = {
        ...matchContext,
        // `null` (leitura falhou) chega ao matcher como `null` nos dois campos
        // — é o que dispara o fail-closed dos dois filtros.
        lead_pipeline_ids: posicao?.pipelines ?? null,
        lead_stage_ids: posicao?.stages ?? null,
      };
    }

    // Filter by trigger_config match
    let matching = workflows.filter((w) =>
      matchesTriggerConfig(triggerType, w.trigger_config, matchContext),
    );

    // Origin guard: skip workflows with copilot nodes when triggered by copilot
    if (source === "copilot" && matching.length > 0) {
      const before = matching.length;
      matching = matching.filter((w) => !workflowHasCopilotNode(w.definition ?? null));
      if (matching.length < before) {
        console.log(`[workflow-trigger] Origin guard: skipped ${before - matching.length} copilot-containing workflows (source=copilot)`);
      }
    }

    if (matching.length === 0) return 0;

    // ── Dedup / Auto-cancel ──
    const matchingIds = matching.map((w: { id: string }) => w.id);
    /**
     * ── O SKIP PASSOU A SER POR NEGÓCIO, NÃO POR PESSOA ────────────────────
     * Era `.eq("lead_id", leadId)` e mais nada. Sob o modelo novo (ADR-0023 §2:
     * "um Lead pode ter vários Negócios, inclusive dois abertos no mesmo
     * funil"), isso proibia o modelo na prática: dois Negócios do mesmo Lead
     * entrando na mesma etapa, e o SEGUNDO era descartado como duplicata —
     * sem erro, sem log, sem nada na tela.
     *
     * Quando o gatilho declara o Negócio, o escopo do skip é o Negócio. Quando
     * não declara (gatilho da pessoa: `lead_created`, `tag_added`), continua
     * sendo a pessoa — que ali é o sujeito certo.
     *
     * Custo assumido na transição: uma execução em voo criada ANTES desta
     * fatia tem `pipeline_entry_id` nulo e não bloqueia mais o mesmo card. O
     * teto é uma redisparada por workflow, na janela de 300s, uma única vez.
     */
    let activeQuery = supabase
      .from("workflow_executions")
      .select("id, workflow_id")
      .eq("lead_id", leadId)
      .in("workflow_id", matchingIds)
      .in("status", ["running", "processing", "waiting_response", "paused"]);
    if (entryId) activeQuery = activeQuery.eq("pipeline_entry_id", entryId);
    const { data: activeExecs } = await activeQuery;

    // ── Dedup: SKIP workflows that already have an in-flight execution for this
    // lead. Applies to ALL trigger types, including stage_changed.
    //
    // stage_changed previously CANCELLED the active execution and started a fresh
    // one from the trigger node — which re-ran every send node, re-dispatching the
    // whole flow (text + audio + image) on each re-entry into the triggering stage.
    // A user re-dropping a lead into a "disparo" column (or the workflow's own
    // stage moves) therefore blasted the lead 7-12× (incident 2026-07-03, Motor 100).
    //
    // `activeExecs` is already filtered to `matchingIds` — i.e. executions of the
    // very workflows about to fire — so an active exec here is always the SAME
    // workflow re-triggering. Cancel-and-restart never protected a distinct flow;
    // skipping is strictly safer. If a genuine re-dispatch is wanted, the prior
    // execution must reach a terminal state first.
    const activeWorkflowIds = new Set((activeExecs ?? []).map((e: { workflow_id: string }) => e.workflow_id));
    const deduped = matching.filter((w: { id: string }) => !activeWorkflowIds.has(w.id));

    if (deduped.length === 0) {
      console.log(`[workflow-trigger] All ${matching.length} workflows already active for ${entryId ? `negócio ${entryId}` : `lead ${leadId}`}, skipping (no re-dispatch)`);
      return 0;
    }

    if (deduped.length < matching.length) {
      console.log(`[workflow-trigger] Dedup: ${matching.length - deduped.length} workflows already active for lead ${leadId}, firing ${deduped.length}`);
    }

    // Atomic dedup key (closes the check-then-insert race the skip above cannot):
    // N near-simultaneous stage_changed events for the same lead compute the SAME
    // key within the window bucket, so the partial-window unique index
    // (workflow_id, lead_id, trigger_dedup_key) lets only the first insert win.
    // stage_changed uses a 300s window (re-dispatching the same lead within 5min is
    // never intended); other triggers use 60s. leadId-less triggers get a null key
    // (never deduped) — distinct NULLs, so they always insert.
    const dedupWindowSeconds = triggerType === "stage_changed" ? 300 : 60;
    const now = new Date();
    const executions = await Promise.all(
      deduped.map(async (w: { id: string }) => ({
        workflow_id: w.id,
        organization_id: organizationId,
        lead_id: leadId,
        // Fatia 1: gravado e ainda não lido por ninguém. O executor passa
        // adiante a partir da fatia 3.
        pipeline_entry_id: entryId,
        deal_id: dealId,
        status: "running",
        // `matchContext` (e não `context`): carrega os funis do lead, que o
        // executor precisa reler para revalidar o matcher. Quando o trigger não
        // usa filtro de funil, `matchContext` É `context` — nada muda.
        context: { trigger_type: triggerType, ...matchContext },
        trigger_dedup_key: leadId
          ? await computeTriggerDedupKey({
              // `context`, NÃO `matchContext`: a chave de dedup precisa ser
              // estável, e os funis do lead mudam com o tempo.
              //
              // O negócio entra na chave EXPLICITAMENTE, e não só por vir
              // dentro do context: o índice único é
              // `(workflow_id, lead_id, trigger_dedup_key)` — sem o id do
              // negócio na chave, dois cards do mesmo lead na mesma etapa
              // colidem no índice e o segundo é descartado pelo
              // `ignoreDuplicates`. Id de entrada não muda, então a chave
              // continua estável.
              triggerType,
              payload: entryId ? { ...ctxObj, pipeline_entry_id: entryId } : ctxObj,
              now,
              windowSeconds: dedupWindowSeconds,
            })
          : null,
      })),
    );

    // ON CONFLICT DO NOTHING (ignoreDuplicates) → concurrent identical fires that
    // computed the same key collapse to a single row at the DB. The returned count
    // is the ATTEMPTED count; the unique index is the actual guarantee.
    const { error: insertError } = await supabase
      .from("workflow_executions")
      .upsert(executions, {
        onConflict: "workflow_id,lead_id,trigger_dedup_key",
        ignoreDuplicates: true,
      });

    if (insertError) {
      console.warn("[workflow-trigger] Insert failed:", insertError.message);
      return 0;
    }

    console.log(`[workflow-trigger] Fired ${deduped.length} workflows for ${triggerType} (dedup-keyed)`);

    return deduped.length;
  } catch (err) {
    console.warn("[workflow-trigger] Error:", err);
    return 0;
  }
}

/**
 * Validates that the trigger context matches the workflow's trigger_config.
 */
export function matchesTriggerConfig(
  triggerType: string,
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): boolean {
  switch (triggerType) {
    case "stage_changed": {
      // ── Filtro por funil (SCRUM-627) ──
      // Formatos VIVOS de config em prod (medido 2026-09-02, 82 ativos):
      //   · pipe_type slug sem prefixo ("whatsapp"/"propostas"), pipeline_id
      //     vazio — 67 ativos (funil de sistema, formato legado);
      //   · pipeline_id uuid, pipe_type vazio — 15 ativos (funil custom);
      //   · nenhum dos dois — "qualquer funil".
      // O contexto UNIFICADO dos gatilhos de banco (20270908006000) manda
      // `pipeline_id` SEMPRE e `pipe_type` como eco legado (slug, só quando o
      // funil é de sistema — some na W6). O casamento é por pipeline_id OU
      // pelo slug legado.
      const cfgPipelineId = asUuidOrNull(config.pipeline_id);
      const cfgPipeType = typeof config.pipe_type === "string" && config.pipe_type.trim() ? config.pipe_type.trim() : null;
      const ctxPipelineId = asUuidOrNull(context.pipeline_id);
      const ctxPipeType = typeof context.pipe_type === "string" && context.pipe_type.trim() ? context.pipe_type.trim() : null;

      if (cfgPipelineId && ctxPipelineId && cfgPipelineId !== ctxPipelineId) return false;
      if (cfgPipeType) {
        if (ctxPipeType) {
          if (cfgPipeType !== ctxPipeType) return false;
        } else if (ctxPipelineId) {
          // Config legada de funil de SISTEMA vs. move num funil que não ecoa
          // slug (custom). Antes isto passava em silêncio — o filtro
          // simplesmente não era aplicado e o workflow disparava para o funil
          // errado. Fail-closed: não é o funil configurado.
          return false;
        }
      }

      if (config.campanha_id && context.campanha_id && config.campanha_id !== context.campanha_id) return false;

      // ── Filtro por etapa ──
      // Configs vivas guardam stage_key em `stages`/`from_stage`/`to_stage`;
      // o editor novo pode gravar stage ID (uuid de `pipeline_stages`). O
      // contexto unificado manda os dois lados (`stage_key`+`stage_id`,
      // `from_stage`+`from_stage_id`) — aceitar id OU key cobre os dois.
      const ctxStageId = asUuidOrNull(context.stage_id);
      const ctxFromStageId = asUuidOrNull(context.from_stage_id);
      if (config.from_stage && context.from_stage
          && config.from_stage !== context.from_stage
          && config.from_stage !== ctxFromStageId) return false;
      const stages = config.stages as string[] | undefined;
      const toStage = context.to_stage as string;
      if (stages && stages.length > 0 && toStage) {
        if (!stages.includes(toStage) && !(ctxStageId && stages.includes(ctxStageId))) return false;
      } else if (config.to_stage && toStage) {
        if (config.to_stage !== toStage && config.to_stage !== ctxStageId) return false;
      }
      return true;
    }

    case "lead_created": {
      // Origem: compara slug normalizado (lowercase/trim) — leads.origin é texto livre
      // por-org (lead_origins). Filtro ativo + lead sem origem NÃO dispara — mantém
      // consistência com o caminho de agendados (ver `wf.filter_origin && !lm.origin`).
      if (config.filter_origin) {
        const want = String(config.filter_origin).toLowerCase().trim();
        const got = context.origin == null ? "" : String(context.origin).toLowerCase().trim();
        if (!got || got !== want) return false;
      }
      // filter_pipe: e.g. "pipe_whatsapp", "pipe_confirmacao", "pipe_propostas"
      const ctxPipe = (context.pipe ?? context.pipe_type) as string | undefined;
      if (config.filter_pipe && ctxPipe && config.filter_pipe !== ctxPipe) return false;
      // Custom pipeline filtering
      if (config.filter_pipeline_id && context.pipeline_id) {
        if (config.filter_pipeline_id !== context.pipeline_id) return false;
      } else if (!config.filter_pipeline_id && context.pipeline_id) {
        // Fired from custom pipeline entry — skip workflows without pipeline filter to avoid duplicates
        return false;
      }
      return true;
    }

    case "tag_added": {
      if (config.tag_id && context.tag_id && config.tag_id !== context.tag_id) return false;
      if (config.tag_name && context.tag_name) {
        if (String(config.tag_name).toLowerCase() !== String(context.tag_name).toLowerCase()) return false;
      }
      return true;
    }

    case "score_reached": {
      const minScore = Number(config.min_score) || 0;
      const currentScore = Number(context.score) || 0;
      return currentScore >= minScore;
    }

    case "lead_replied": {
      if (config.channel && config.channel !== "any" && context.channel && config.channel !== context.channel) return false;

      // ── Filtro por funil ──
      // `pipeline_ids` é uma lista de `pipelines.id`. Um campo só cobre funil
      // padrão E custom porque `pipelines` é a UNIÃO dos dois: cada linha de
      // `custom_pipelines` é espelhada ali com o MESMO uuid (trigger
      // `trg_sync_custom_pipeline`). Medido em PROD 2026-08-11: 379 pipelines
      // = 294 system + 85 custom, e 0 custom_pipelines sem espelho.
      //
      // Por isso NÃO copiamos a forma do `lead_created` (`filter_pipe` slug +
      // `filter_pipeline_id` uuid): aquele par duplica o mesmo conceito, e o
      // slug lá é comparado contra um `pipe_type` que o trigger PG grava
      // HARDCODED como 'pipe_whatsapp'.
      //
      // Semântica: OR — basta o lead estar em QUALQUER um dos funis marcados.
      // Lista vazia/ausente = qualquer funil (mesma convenção de `channel`).
      const wantedPipelines = normalizePipelineIds(config.pipeline_ids);
      if (wantedPipelines.length > 0) {
        const leadPipelines = context.lead_pipeline_ids;
        // Fail-closed: sem a lista de funis do lead o filtro é inavaliável, e
        // disparar seria pior que não disparar (a automação sairia para leads
        // fora do funil escolhido). `fireTrigger` injeta a lista sempre que
        // algum workflow candidato usa o filtro; ausência aqui = leitura falhou.
        if (!Array.isArray(leadPipelines)) return false;
        const isInAnyWanted = leadPipelines.some((id) => wantedPipelines.includes(String(id)));
        if (!isInAnyWanted) return false;
      }

      // ── Filtro por etapa ──
      // Chave é `pipeline_entries.stage_id` (uuid), não `stage_key` (texto com
      // escopo por funil): o uuid é inequívoco entre funis, e o mesmo apelido
      // de etapa se repete em funis diferentes. Medido em PROD 2026-09-03:
      // `stage_id` preenchido em 48.130 das 48.171 entradas — as 41 restantes
      // não casam filtro nenhum, por fail-closed.
      //
      // Filtro PURO (ADR-0023 + spec): basta o lead ter ALGUM card numa das
      // etapas marcadas. A execução não se amarra ao Negócio que casou, e um
      // lead com dois cards elegíveis gera UMA execução, não duas.
      const wantedStages = normalizePipelineIds(config.stage_ids);
      if (wantedStages.length > 0) {
        const leadStages = context.lead_stage_ids;
        // Fail-closed, mesmo motivo do funil: sem saber onde o lead está, o
        // filtro é inavaliável e disparar levaria a automação a lead de fora.
        if (!Array.isArray(leadStages)) return false;
        if (!leadStages.some((id) => wantedStages.includes(String(id)))) return false;
      }

      // ── Filtro por instância de origem ──
      // Existe para o caso de duas Instances falando com o MESMO lead: só a
      // resposta que chega no número escolhido conta. `channel` não resolve —
      // ele distingue WhatsApp de Meta, não um número nosso do outro.
      //
      // `normalizePipelineIds` é reusada por ser normalização de lista de
      // strings, não algo específico de funil: mesmo jsonb não-validado, mesmo
      // descarte de não-string e de vazio.
      const wantedSources = normalizePipelineIds(config.source_ids);
      if (wantedSources.length > 0) {
        // Fail-closed, pelo mesmo motivo do funil: sem saber por onde a
        // mensagem entrou, o filtro é inavaliável, e disparar transformaria
        // "só o número do Closer" em "qualquer número" em silêncio. É o que
        // aconteceria hoje no `notificame-webhook`, que dispara sem contexto.
        const origem = context.instance_id;
        if (typeof origem !== "string" || !origem) return false;
        if (!wantedSources.includes(origem)) return false;
      }

      if (config.contains_text && context.message) {
        return String(context.message).toLowerCase().includes(String(config.contains_text).toLowerCase());
      }
      return true;
    }

    case "lead_no_reply": {
      // Timeout is checked by the caller; config match is always true
      return true;
    }

    case "meeting_confirmed": {
      if (config.pipe_type && context.pipe_type && config.pipe_type !== context.pipe_type) return false;
      return true;
    }

    case "meeting_not_confirmed": {
      // hours_before is checked by the caller
      return true;
    }

    case "meeting_held":
    case "meeting_no_show": {
      // Sem filtro de config, igual ao `ELSE RETURN TRUE` de
      // `matches_workflow_trigger_config` no banco. Os dois lados precisam
      // concordar: o gatilho é disparado por trigger SQL
      // (`trg_workflow_meeting_outcome`), e um matcher mais restrito aqui faria
      // o mesmo desfecho executar no banco e ser descartado no executor.
      return true;
    }

    case "proposal_accepted":
    case "proposal_lost": {
      return true;
    }

    case "followup_overdue": {
      return true;
    }

    case "webhook_received": {
      if (config.webhook_key && context.webhook_key && config.webhook_key !== context.webhook_key) return false;
      return true;
    }

    case "deal_created": {
      // Fail-closed: por padrão só negócio vinculado a lead — os nós downstream
      // (mensagem, tag, stage) todos precisam de lead.
      const requireLead = config.require_lead !== false;
      if (requireLead && !context.lead_id) return false;

      const source = (config.source as string) || "any";
      if (source !== "any" && source !== context.deal_source) return false;

      if (config.filter_owner_id && config.filter_owner_id !== context.owner_id) return false;

      if (config.min_value != null) {
        const min = Number(config.min_value) || 0;
        if ((Number(context.deal_value) || 0) < min) return false;
      }

      return true;
    }

    case "lead_assigned": {
      if (config.role && config.role !== "any" && context.role && config.role !== context.role) return false;
      return true;
    }

    case "campaign_status_changed":
    case "lead_added_to_campaign":
    case "lead_removed_from_campaign":
    case "campaign_lead_replied":
    case "campaign_lead_no_reply":
    case "campaign_completed": {
      if (config.campaign_id && context.campanha_id && config.campaign_id !== context.campanha_id) return false;
      return true;
    }

    case "field_changed": {
      if (config.field_name && context.field_name && config.field_name !== context.field_name) return false;
      if (config.new_value && context.new_value && config.new_value !== context.new_value) return false;
      return true;
    }

    case "cron": {
      // Cron matching is done by the caller
      return true;
    }

    default:
      return true;
  }
}

/**
 * Fire stage_changed trigger — replacement for frontend workflowTrigger.ts
 */
export async function fireStageChangedTrigger(params: {
  supabase: SupabaseClient;
  organizationId: string;
  leadId: string;
  pipeType?: string;
  pipelineId?: string;
  fromStage?: string;
  toStage: string;
}): Promise<number> {
  return fireTrigger({
    supabase: params.supabase,
    organizationId: params.organizationId,
    triggerType: "stage_changed",
    leadId: params.leadId,
    context: {
      trigger: "stage_changed",
      pipe_type: params.pipeType || null,
      pipeline_id: params.pipelineId || null,
      from_stage: params.fromStage || null,
      to_stage: params.toStage,
    },
  });
}

/**
 * Process cron-type workflow triggers.
 * Called every minute by pg_cron. Checks each cron workflow's expression
 * against the current minute.
 */
export async function processCronTriggers(supabase: SupabaseClient): Promise<number> {
  const { data: cronWorkflows, error } = await supabase
    .from("workflows")
    .select("id, organization_id, trigger_config")
    .eq("trigger_type", "cron")
    .eq("is_active", true);

  if (error || !cronWorkflows?.length) return 0;

  let count = 0;
  const now = new Date();

  for (const wf of cronWorkflows) {
    const config = wf.trigger_config as { cron_expression?: string };
    if (!config.cron_expression) continue;

    if (matchesCronExpression(config.cron_expression, now)) {
      // Cron workflows don't have a specific lead — they run org-wide
      // The workflow definition should have its own logic for selecting leads
      const { error: insertError } = await supabase.from("workflow_executions").insert({
        workflow_id: wf.id,
        organization_id: wf.organization_id,
        lead_id: null,
        status: "running",
        context: { trigger_type: "cron", cron_expression: config.cron_expression },
      });

      if (!insertError) count++;
    }
  }

  return count;
}

/**
 * Simple cron expression matcher (minute hour day month weekday)
 */
function matchesCronExpression(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts;

  return (
    matchesCronField(minExpr, date.getMinutes()) &&
    matchesCronField(hourExpr, date.getHours()) &&
    matchesCronField(dayExpr, date.getDate()) &&
    matchesCronField(monthExpr, date.getMonth() + 1) &&
    matchesCronField(weekdayExpr, date.getDay())
  );
}

function matchesCronField(expr: string, value: number): boolean {
  if (expr === "*") return true;

  // Handle */N
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.substring(2));
    return !isNaN(step) && step > 0 && value % step === 0;
  }

  // Handle comma-separated values
  const parts = expr.split(",");
  for (const part of parts) {
    // Handle range N-M
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (!isNaN(start) && !isNaN(end) && value >= start && value <= end) return true;
    } else {
      if (parseInt(part) === value) return true;
    }
  }

  return false;
}

function workflowHasCopilotNode(definition: { nodes: { type: string }[] } | null | undefined): boolean {
  if (!definition?.nodes) return false;
  return definition.nodes.some((n) => n.type === "copilot");
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduled_date — trigger "Antes de uma data"
//
// Dispara o workflow uma vez por lead em momentos relativos à data da reunião
// marcada de cada lead (`pipeline_entries.metadata->>'meeting_date'`). Toda a
// regra de decisão vive na função pura `planScheduledDateDispatches` (sem I/O);
// a casca `processScheduledDateTriggers` faz o I/O e roda no loop do pg_cron.
// PRD: issue #895. Fatia 1 (#896): apenas o âncora `antes_da_reuniao`.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SCHEDULED_TZ = "America/Sao_Paulo";
const DEFAULT_SEND_TIME = "09:00";
/** Teto do catch-up em segundos: tolera atraso do cron/outage sem disparar janelas perdidas. */
const SCHEDULED_GRACE_CAP_SECONDS = 3600;

export type ScheduledDispatchUnit = "days" | "hours" | "minutes";

export interface ScheduledDispatchItem {
  anchor: "ao_marcar" | "antes_da_reuniao";
  value?: number;
  unit?: ScheduledDispatchUnit;
  send_time?: string;
}

/** Workflow scheduled_date já resolvido pela casca (pipeline_id concreto + tz da org). */
export interface ScheduledDateWorkflow {
  id: string;
  organization_id: string;
  /** pipeline alvo resolvido (de pipe_type/sistema ou pipeline_id/custom). */
  pipeline_id: string;
  stages: string[];
  filter_origin?: string | null;
  dispatches: ScheduledDispatchItem[];
  timezone?: string;
}

/** Reunião marcada de um lead, candidata da audiência. */
export interface LeadMeeting {
  organization_id: string;
  lead_id: string;
  pipeline_id: string;
  stage_key: string;
  meeting_date: string; // ISO timestamptz
  origin?: string | null;
}

export interface ScheduledFiredLogEntry {
  workflow_id: string;
  lead_id: string;
  meeting_date: string;
  item_key: string;
}

export interface PlannedScheduledDispatch {
  workflow_id: string;
  organization_id: string;
  lead_id: string;
  meeting_date: string;
  item_key: string;
}

const UNIT_SECONDS: Record<ScheduledDispatchUnit, number> = {
  days: 86_400,
  hours: 3_600,
  minutes: 60,
};

/** Offset do timezone (ms) num dado instante — via Intl, sem libs externas. */
function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUTC - date.getTime();
}

/** Converte um "relógio de parede" (Y/M/D HH:MM no fuso `tz`) para epoch ms. */
function zonedWallTimeToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naiveUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Dupla-correção cobre a maioria dos casos de DST (BR não usa DST desde 2019).
  const offset1 = tzOffsetMs(timeZone, new Date(naiveUTC));
  const offset2 = tzOffsetMs(timeZone, new Date(naiveUTC - offset1));
  return naiveUTC - offset2;
}

/**
 * Calcula o instante (epoch ms) em que um item deve disparar.
 * Retorna `null` se o âncora ainda não é suportado nesta fatia.
 */
function computeFireAt(item: ScheduledDispatchItem, meetingMs: number, tz: string): number | null {
  if (item.anchor === "antes_da_reuniao") {
    const unit = item.unit ?? "days";
    const value = Number(item.value) || 0;
    const offsetMs = value * UNIT_SECONDS[unit] * 1000;
    const target = meetingMs - offsetMs;
    if (unit === "days") {
      // Para "dias antes", o disparo sai no horário do dia `send_time` no fuso da org.
      const sendTime = item.send_time || DEFAULT_SEND_TIME;
      const [hh, mm] = sendTime.split(":").map((n) => Number(n));
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const parts = dtf.formatToParts(new Date(target));
      const map: Record<string, number> = {};
      for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
      return zonedWallTimeToEpoch(map.year, map.month, map.day, hh || 0, mm || 0, tz);
    }
    return target;
  }
  // ao_marcar — Fatia 2 (#897). Não dispara nesta fatia.
  return null;
}

/** Chave de dedup canônica — normaliza meeting_date (formatos ISO variados) por epoch. */
function dedupKey(workflowId: string, leadId: string, meetingDate: string, itemKey: string): string {
  const ms = new Date(meetingDate).getTime();
  return `${workflowId}|${leadId}|${ms}|${itemKey}`;
}

/** item_key estável por posição na lista — editar o valor de um item não re-arma o já disparado. */
export function scheduledItemKey(index: number): string {
  return `item-${index}`;
}

/**
 * Função PURA: dado o instante atual, os workflows scheduled_date, as reuniões
 * candidatas e o log de disparos já feitos, retorna os disparos a fazer agora.
 *
 * Regras:
 *  - Audiência: org + pipeline + etapa(s) (vazio = qualquer) + origem (se configurada).
 *  - Ignora lead sem `meeting_date`.
 *  - Nunca dispara reunião já passada (`now > meeting_date`).
 *  - `antes_da_reuniao`: dispara quando `now ≥ meeting_date − offset` (no `send_time` p/ dias).
 *  - Janela perdida: pula se `now − fireAt` excede o grace (antecedência não coube / outage longo).
 *  - Dedup: nada re-dispara para (workflow, lead, meeting_date, item_key) já logado.
 */
export function planScheduledDateDispatches(
  now: Date,
  workflows: ScheduledDateWorkflow[],
  leadMeetings: LeadMeeting[],
  firedLog: ScheduledFiredLogEntry[],
): PlannedScheduledDispatch[] {
  const nowMs = now.getTime();
  const fired = new Set(
    firedLog.map((f) => dedupKey(f.workflow_id, f.lead_id, f.meeting_date, f.item_key)),
  );
  const planned: PlannedScheduledDispatch[] = [];
  const emitted = new Set<string>();

  for (const wf of workflows) {
    const tz = wf.timezone || DEFAULT_SCHEDULED_TZ;
    const stages = wf.stages || [];

    for (const lm of leadMeetings) {
      // ── Audiência ──
      if (lm.organization_id !== wf.organization_id) continue;
      if (lm.pipeline_id !== wf.pipeline_id) continue;
      if (stages.length > 0 && !stages.includes(lm.stage_key)) continue;
      if (wf.filter_origin) {
        // Slug normalizado (lowercase/trim) — mesma regra do lead_created em matchesTriggerConfig.
        const want = String(wf.filter_origin).toLowerCase().trim();
        const got = lm.origin == null ? "" : String(lm.origin).toLowerCase().trim();
        if (!got || got !== want) continue;
      }
      if (!lm.meeting_date) continue;

      const meetingMs = new Date(lm.meeting_date).getTime();
      if (isNaN(meetingMs)) continue;
      if (nowMs > meetingMs) continue; // reunião passada — nunca dispara

      wf.dispatches.forEach((item, index) => {
        const fireAt = computeFireAt(item, meetingMs, tz);
        if (fireAt === null) return;
        if (nowMs < fireAt) return; // ainda não chegou a hora

        // Janela perdida: grace pequeno o suficiente p/ rejeitar antecedência que não coube.
        const offsetMs =
          item.anchor === "antes_da_reuniao"
            ? (Number(item.value) || 0) * UNIT_SECONDS[item.unit ?? "days"] * 1000
            : 0;
        const graceMs = Math.min(offsetMs / 2, SCHEDULED_GRACE_CAP_SECONDS * 1000);
        if (nowMs - fireAt > graceMs) return; // janela perdida

        const itemKey = scheduledItemKey(index);
        const key = dedupKey(wf.id, lm.lead_id, lm.meeting_date, itemKey);
        if (fired.has(key) || emitted.has(key)) return; // dedup

        emitted.add(key);
        planned.push({
          workflow_id: wf.id,
          organization_id: wf.organization_id,
          lead_id: lm.lead_id,
          meeting_date: lm.meeting_date,
          item_key: itemKey,
        });
      });
    }
  }

  return planned;
}

/**
 * Casca fina (I/O) do trigger scheduled_date — espelha `processCronTriggers`.
 * Chamada a cada ~1 min pelo loop do `process-workflow-executions`.
 */
export async function processScheduledDateTriggers(supabase: SupabaseClient): Promise<number> {
  const { data: rawWorkflows, error } = await supabase
    .from("workflows")
    .select("id, organization_id, trigger_config")
    .eq("trigger_type", "scheduled_date")
    .eq("is_active", true);

  if (error || !rawWorkflows?.length) return 0;

  // Resolve o pipeline alvo de cada workflow (sistema via slug, ou custom via pipeline_id).
  const resolved: ScheduledDateWorkflow[] = [];
  for (const wf of rawWorkflows) {
    const config = (wf.trigger_config || {}) as {
      pipe_type?: string;
      pipeline_id?: string;
      stages?: string[];
      filter_origin?: string;
      dispatches?: ScheduledDispatchItem[];
    };
    if (!config.dispatches?.length) continue;

    let pipelineId = config.pipeline_id || null;
    if (!pipelineId && config.pipe_type) {
      const slug = config.pipe_type.replace(/^pipe_/, "");
      pipelineId = await resolveScheduledPipelineId(supabase, wf.organization_id, slug);
    }
    if (!pipelineId) continue;

    resolved.push({
      id: wf.id,
      organization_id: wf.organization_id,
      pipeline_id: pipelineId,
      stages: config.stages || [],
      filter_origin: config.filter_origin || null,
      dispatches: config.dispatches,
      timezone: DEFAULT_SCHEDULED_TZ,
    });
  }

  if (resolved.length === 0) return 0;

  // Candidatos: entradas dos pipelines alvo que têm meeting_date.
  const pipelineIds = [...new Set(resolved.map((w) => w.pipeline_id))];
  const { data: entries } = await supabase
    .from("pipeline_entries")
    .select("organization_id, lead_id, pipeline_id, stage_key, metadata")
    .in("pipeline_id", pipelineIds)
    .limit(2000);

  const leadMeetings: LeadMeeting[] = (entries || [])
    .map((e: Record<string, unknown>) => {
      const meta = (e.metadata || {}) as Record<string, unknown>;
      const meetingDate = meta.meeting_date as string | undefined;
      if (!meetingDate) return null;
      return {
        organization_id: e.organization_id as string,
        lead_id: e.lead_id as string,
        pipeline_id: e.pipeline_id as string,
        stage_key: e.stage_key as string,
        meeting_date: meetingDate,
        origin: null,
      } as LeadMeeting;
    })
    .filter((x): x is LeadMeeting => x !== null);

  if (leadMeetings.length === 0) return 0;

  // Log de disparos já feitos para esses workflows.
  const workflowIds = resolved.map((w) => w.id);
  const { data: logRows } = await supabase
    .from("scheduled_date_dispatch_log")
    .select("workflow_id, lead_id, meeting_date, item_key")
    .in("workflow_id", workflowIds);

  const firedLog: ScheduledFiredLogEntry[] = (logRows || []).map((r: Record<string, unknown>) => ({
    workflow_id: r.workflow_id as string,
    lead_id: r.lead_id as string,
    meeting_date: r.meeting_date as string,
    item_key: r.item_key as string,
  }));

  const planned = planScheduledDateDispatches(new Date(), resolved, leadMeetings, firedLog);

  let count = 0;
  for (const d of planned) {
    // Grava o ledger primeiro: a unicidade (workflow,lead,meeting_date,item) é o guard
    // anti-corrida contra ticks sobrepostos. Conflito ⇒ já disparou ⇒ pula a execução.
    const { error: logErr } = await supabase.from("scheduled_date_dispatch_log").insert({
      organization_id: d.organization_id,
      workflow_id: d.workflow_id,
      lead_id: d.lead_id,
      meeting_date: d.meeting_date,
      item_key: d.item_key,
    });
    if (logErr) continue;

    const { error: execErr } = await supabase.from("workflow_executions").insert({
      workflow_id: d.workflow_id,
      organization_id: d.organization_id,
      lead_id: d.lead_id,
      status: "running",
      context: {
        trigger_type: "scheduled_date",
        meeting_date: d.meeting_date,
        item_key: d.item_key,
      },
    });
    if (!execErr) count++;
  }

  return count;
}

/** Resolve pipeline de sistema por slug. Inline para não acoplar a casca ao pipeline-adapter. */
async function resolveScheduledPipelineId(
  supabase: SupabaseClient,
  orgId: string,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .eq("type", "system")
    .maybeSingle();

  if (error || !data) return null;
  return data.id as string;
}
