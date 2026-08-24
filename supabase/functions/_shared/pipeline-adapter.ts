/**
 * Unified pipeline_entries adapter for edge functions.
 *
 * Replaces direct reads/writes to legacy pipe_whatsapp, pipe_confirmacao,
 * pipe_propostas tables. The reverse sync trigger keeps legacy tables
 * in sync during the migration period.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type PipeSlug = "whatsapp" | "confirmacao" | "propostas";

export interface PipelineEntry {
  id: string;
  organization_id: string;
  pipeline_id: string;
  lead_id: string;
  stage_key: string;
  assigned_to: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  entered_at: string;
  stage_changed_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

const pipelineIdCache = new Map<string, string>();

/**
 * Resolve a target stage_key against the org's ACTIVE pipeline_stages.
 *
 * Root-cause guard for "ghost stages": external ingest (Make/n8n/Meta) sends a
 * stage slug as a fixed string. If that slug was deactivated/renamed in the org
 * (or is a hardcoded default the org never uses), the lead lands in a stage the
 * Kanban does not render — invisible. This resolver coerces the target to a real
 * active stage so a lead can never enter a ghost stage from ingest.
 *
 * Resolution order:
 *   1. `requested` if it matches an active stage_key → use as-is.
 *   2. else → first active stage (min position).
 *   3. else (org has no active stages — never seeded) → `null`; caller decides
 *      a last-resort fallback (e.g. the static DEFAULT seed slug).
 */
export async function resolveActiveStageKey(
  supabase: SupabaseClient,
  orgId: string,
  slug: PipeSlug,
  requested?: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("stage_key, position")
    .eq("organization_id", orgId)
    .eq("pipeline_type", slug)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) {
    console.warn(`[pipeline-adapter] resolveActiveStageKey query failed for ${slug}@${orgId}:`, error);
    // On query failure, trust the requested value rather than dropping the lead.
    return requested ?? null;
  }

  const active = (data ?? []) as { stage_key: string; position: number }[];
  if (active.length === 0) return null;

  if (requested && active.some((s) => s.stage_key === requested)) {
    return requested;
  }

  const fallback = active[0].stage_key;
  if (requested && requested !== fallback) {
    console.warn(
      `[pipeline-adapter] stage "${requested}" not active in ${slug}@${orgId}; remapping to first active stage "${fallback}" (ghost-stage guard).`,
    );
  }
  return fallback;
}

export async function resolvePipelineId(
  supabase: SupabaseClient,
  orgId: string,
  slug: PipeSlug,
): Promise<string | null> {
  const key = `${orgId}:${slug}`;
  const cached = pipelineIdCache.get(key);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .eq("type", "system")
    .maybeSingle();

  if (error || !data) {
    console.warn(`[pipeline-adapter] resolvePipelineId failed for ${slug}@${orgId}:`, error);
    return null;
  }

  pipelineIdCache.set(key, data.id);
  return data.id;
}

/**
 * Teto de linhas lidas por `(pipeline_id, lead_id)`.
 *
 * Hoje o valor é indiferente — o unique garante no máximo 1 linha. Depois do M1
 * (drop dos cadeados) delimita a leitura para que um caminho quente (turn do
 * Copilot, webhook de ingest) não vire scan aberto. Um lead com mais de
 * `PIPE_ENTRY_READ_CAP` negócios no MESMO funil é anomalia, não uso normal — por
 * isso batemos log ao encostar no teto em vez de aumentá-lo em silêncio.
 */
const PIPE_ENTRY_READ_CAP = 50;

type PipeEntryRead =
  | { ok: true; rows: PipelineEntry[] }
  | { ok: false; rows: null };

/**
 * Lê TODAS as entries de `(pipeline_id, lead_id)`, ordenadas, tolerando N linhas.
 *
 * Por que não `.maybeSingle()`: com mais de uma linha o postgrest-js **zera o
 * `data`** e devolve `PGRST116` — verificado na cópia instalada neste repo,
 * `node_modules/@supabase/postgrest-js/dist/index.mjs:107-119`
 * (`if (isMaybeSingle && method === "GET" && data.length > 1) { error = …; data = null; }`).
 * O swallow que converte erro em "vazio" (linha 137-141) só cobre `details`
 * contendo `"0 rows"`, então "existem 2" fica **indistinguível de "não existe"**.
 * Num leitor isso faz o agente achar que o lead não está no funil; num escritor
 * que faz select→update→insert, faz inserir mais uma linha a cada chamada.
 *
 * Aqui a distinção sobrevive: `ok:false` = a leitura falhou (não sei), `rows: []`
 * = não existe, `rows.length >= 1` = existe. Quem chama decide o que fazer com
 * cada caso — que é justamente o que `.maybeSingle()` tornava impossível.
 *
 * A ordenação em SQL espelha `pickActiveEntry`; a seleção final é refeita em JS
 * (ver lá). A redundância é de propósito: o runtime das edge functions resolve
 * a própria cópia do postgrest-js via esm.sh, que **não foi medida aqui** — se
 * `nullsFirst` se comportasse diferente lá, a escolha em JS ainda acerta.
 */
async function readPipeEntries(
  supabase: SupabaseClient,
  pipelineId: string,
  leadId: string,
): Promise<PipeEntryRead> {
  const { data, error } = await supabase
    .from("pipeline_entries")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .eq("lead_id", leadId)
    .order("closed_at", { ascending: false, nullsFirst: true })
    .order("stage_changed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PIPE_ENTRY_READ_CAP);

  if (error) return { ok: false, rows: null };

  const rows = (data ?? []) as PipelineEntry[];
  if (rows.length >= PIPE_ENTRY_READ_CAP) {
    console.warn(
      `[pipeline-adapter] leitura de pipeline_entries bateu o teto de ${PIPE_ENTRY_READ_CAP} linhas para pipeline=${pipelineId} lead=${leadId}. Pode haver entry fora da janela lida — investigar duplicação antes de subir o teto.`,
    );
  }
  return { ok: true, rows };
}

/**
 * Escolhe QUAL entry representa o lead no funil quando existe mais de uma.
 *
 * Critério, nesta ordem:
 *   1. negócio ABERTO (`closed_at IS NULL`) ganha de negócio fechado;
 *   2. entre os empatados, o de `stage_changed_at` mais recente;
 *   3. desempate por `created_at`, depois por `id`.
 *
 * ⚠️ **Contrato**: só o passo 1 está NESTA função. Os passos 2-4 vêm do `ORDER BY`
 * de `readPipeEntries` — passar um array não-ordenado devolve resposta errada sem
 * erro. Sempre alimente daqui: `pickActiveEntry(read.rows)`.
 *
 * **Por que "aberto primeiro"** — decidido lendo os chamadores. Os de LEITURA
 * (`copilot/context-loader.ts:116,440`, `copilot/agent-router.ts:78`,
 * `copilot/lead-profile-builder.ts:43`, `workflow-action-handler.ts:152,161`,
 * `action-handlers/whatsapp-helpers.ts:399,407`) usam `stage_key`/`metadata` para
 * rotear agente e preencher variável de template. Os de ESCRITA (`upsertPipeEntry`,
 * `lead-webhook`, `actions/schedule-meeting.ts:205,275`,
 * `action-handlers/pipe-operations.ts:92`, `google-calendar-*`, `webhook-*`) usam
 * para escolher qual card mover. Nos dois casos, descrever ou mover um negócio já
 * ganho/perdido no lugar do que está em andamento é o erro mais caro.
 * `stage_changed_at` sozinho não resolveria: um negócio fechado ontem é mais
 * recente que um aberto e parado há uma semana — e ainda assim o aberto é o certo.
 *
 * **`closed_at` é sinal confiável?** Medido em prod 2026-07-31: das 36.709 entries,
 * as 763 em `stage_key` 'vendido' ou 'perdido' têm 763 com `closed_at` preenchido
 * — cobertura 100%. O schema já trata "aberto" como conceito de primeira classe:
 * índice parcial `idx_pipeline_entries_open_snapshot … WHERE closed_at IS NULL`.
 * Ressalva medida: 56 entries têm `closed_at` preenchido FORA de stage terminal.
 * A causa não foi investigada (reabertura sem limpar o campo é hipótese, não fato).
 * Efeito: essas caem para o fim da fila. É estado herdado, ortogonal a esta
 * correção, e não estamos consertando aqui.
 *
 * **Por que ordem total (termina em `id`)** — leitor e escritor rodam em processos
 * separados. Se dois chamadores desempatassem diferente, o Copilot descreveria o
 * negócio A enquanto o webhook move o negócio B.
 *
 * Hoje isto é no-op: com os dois unique ativos
 * (`uq_pipeline_entries_pipeline_lead` + `idx_pipeline_entries_pipeline_lead`)
 * `rows.length` é 0 ou 1, e 0 grupos duplicados existem em prod (medido
 * 2026-07-31). O critério só passa a ter efeito depois do M1.
 */
function pickActiveEntry(rows: PipelineEntry[]): PipelineEntry | null {
  if (rows.length === 0) return null;
  return rows.find((r) => r.closed_at == null) ?? rows[0];
}

export async function getPipeEntry(
  supabase: SupabaseClient,
  leadId: string,
  orgId: string,
  slug: PipeSlug,
): Promise<PipelineEntry | null> {
  const pipelineId = await resolvePipelineId(supabase, orgId, slug);
  if (!pipelineId) return null;

  const read = await readPipeEntries(supabase, pipelineId, leadId);

  if (!read.ok) {
    // Falha de leitura continua devolvendo null — comportamento INALTERADO de
    // propósito. Estes chamadores são de leitura (prompt, variável de template):
    // degradar para "sem entry" é o que já acontecia e não escreve nada.
    console.warn("[pipeline-adapter] getPipeEntry falhou ao ler pipeline_entries:", {
      pipelineId,
      leadId,
    });
    return null;
  }

  if (read.rows.length > 1) {
    // Sinal explícito de "existem N" — o que `.maybeSingle()` apagava.
    console.warn(
      `[pipeline-adapter] ${read.rows.length} entries para pipeline=${pipelineId} lead=${leadId}; usando a escolhida por pickActiveEntry (aberta > mais recente).`,
    );
  }

  return pickActiveEntry(read.rows);
}

/**
 * Versão em lote de `getPipeEntry`: devolve **no máximo uma entry por lead** —
 * a mesma que `pickActiveEntry` escolheria (aberta > mais recente).
 *
 * **Por que achatar aqui, e não deixar para o chamador.** Os dois consumidores
 * (`calculate-lead-score/index.ts:145-153` e
 * `process-copilot-followups/index.ts:213-214`) já reduzem o array a um
 * `Map<lead_id, entry>` — e faziam isso com regras OPOSTAS: o primeiro com
 * `if (!map.has(id))` (primeiro da lista vence), o segundo com
 * `new Map(rows.map(...))` (último da lista vence). Enquanto o unique garantia
 * uma linha por `(pipeline_id, lead_id)` a divergência era invisível. Depois do
 * M1, o mesmo lote passaria a fazer o score ler um negócio e o follow-up ler
 * outro, nenhum dos dois necessariamente o corrente. Devolvendo já achatado,
 * primeiro-vence e último-vence colapsam na MESMA linha — e é a mesma que
 * `getPipeEntry` e `upsertPipeEntry` usam, que é o ponto: kanban, score,
 * follow-up e Copilot têm de concordar sobre qual negócio é o corrente.
 *
 * O `ORDER BY` espelha `readPipeEntries` porque `pickActiveEntry` só implementa
 * o passo 1 do critério — os desempates vêm da ordenação (ver o contrato lá).
 *
 * Sem `LIMIT` de propósito: o teto de `readPipeEntries` é por
 * `(pipeline_id, lead_id)`; aqui um corte truncaria leads inteiros do lote, o
 * que seria pior (dado faltando em silêncio) do que ler algumas linhas a mais.
 */
export async function getPipeEntriesByLeads(
  supabase: SupabaseClient,
  leadIds: string[],
  orgId: string,
  slug: PipeSlug,
): Promise<PipelineEntry[]> {
  if (leadIds.length === 0) return [];

  const pipelineId = await resolvePipelineId(supabase, orgId, slug);
  if (!pipelineId) return [];

  const { data, error } = await supabase
    .from("pipeline_entries")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .in("lead_id", leadIds)
    .order("closed_at", { ascending: false, nullsFirst: true })
    .order("stage_changed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.warn("[pipeline-adapter] getPipeEntriesByLeads error:", error);
    return [];
  }

  // Agrupa preservando a ordem do SQL — `pickActiveEntry` depende dela.
  const byLead = new Map<string, PipelineEntry[]>();
  for (const row of (data || []) as PipelineEntry[]) {
    const group = byLead.get(row.lead_id);
    if (group) group.push(row);
    else byLead.set(row.lead_id, [row]);
  }

  const picked: PipelineEntry[] = [];
  let leadsComMaisDeUma = 0;
  for (const group of byLead.values()) {
    if (group.length > 1) leadsComMaisDeUma++;
    const entry = pickActiveEntry(group);
    if (entry) picked.push(entry);
  }

  if (leadsComMaisDeUma > 0) {
    console.warn(
      `[pipeline-adapter] getPipeEntriesByLeads: ${leadsComMaisDeUma} de ${byLead.size} lead(s) com mais de uma entry em pipeline=${pipelineId}; devolvendo a escolhida por pickActiveEntry (aberta > mais recente).`,
    );
  }

  return picked;
}

/**
 * Resultado de `upsertPipeEntryDetailed`.
 *
 * Existe porque `string | null` achata causas diferentes em "null", e vários
 * chamadores traduzem `null` em erro visível (`success:false`,
 * `report.rejected++`) — sem distinguir, "não havia funil" aparece para o
 * cliente como "erro ao inserir proposta".
 *
 * Já teve um quarto caso, `skipped_deal_manual_only`: a org que ligava a flag
 * `deal_manual_only` não queria Negócio nascendo por porta automática. A flag
 * foi aposentada (#1774) — pelo ADR-0030 §2 a pré-autorização é a própria
 * ferramenta (Workflow ativo, chave escopada), não uma configuração à parte.
 */
export type UpsertPipeEntryResult =
  | { status: "created" | "updated"; entryId: string }
  | { status: "no_pipeline" }
  | { status: "read_failed" }
  | { status: "write_failed" };

/**
 * Versão fina de `upsertPipeEntryDetailed`: devolve o id ou `null`.
 *
 * Mantida com a assinatura histórica porque os ~34 call sites do repo quase
 * todos fazem `await` sem ler o retorno. Quem precisa distinguir "pulei por
 * política" de "falhei" usa `upsertPipeEntryDetailed`.
 */
export async function upsertPipeEntry(
  supabase: SupabaseClient,
  params: {
    leadId: string;
    orgId: string;
    slug: PipeSlug;
    stageKey: string;
    metadata?: Record<string, unknown>;
    assignedTo?: string | null;
    notes?: string | null;
  },
): Promise<string | null> {
  const result = await upsertPipeEntryDetailed(supabase, params);
  return result.status === "created" || result.status === "updated" ? result.entryId : null;
}

export async function upsertPipeEntryDetailed(
  supabase: SupabaseClient,
  params: {
    leadId: string;
    orgId: string;
    slug: PipeSlug;
    stageKey: string;
    metadata?: Record<string, unknown>;
    assignedTo?: string | null;
    notes?: string | null;
  },
): Promise<UpsertPipeEntryResult> {
  const pipelineId = await resolvePipelineId(supabase, params.orgId, params.slug);
  if (!pipelineId) return { status: "no_pipeline" };

  // Lê direto (não via getPipeEntry) porque aqui a diferença entre "a leitura
  // falhou" e "não existe entry" decide INSERT vs não-INSERT — e getPipeEntry
  // achata as duas em `null`.
  const read = await readPipeEntries(supabase, pipelineId, params.leadId);

  if (!read.ok) {
    // ⚠️ MUDANÇA DE COMPORTAMENTO — não é no-op, e é deliberada.
    //
    // Antes: falha de leitura caía no ramo do INSERT. Se de fato não havia linha,
    // o insert passava; se havia, o unique devolvia 23505 e a função retornava null.
    // Depois do M1 o unique não existe mais, então o mesmo caminho passaria a
    // CRIAR uma entry duplicada a cada falha transitória de leitura.
    //
    // Agora: falha de leitura aborta sem escrever. O delta observável hoje é
    // estreito — só o caso "leitura falhou E não existia entry", que antes criava
    // a entry e agora devolve null. Trocamos isso de propósito: negócio duplicado
    // é permanente, aparece no kanban do cliente e suja métrica de venda; upsert
    // pulado é retentado no próximo turn/ingest (34 call sites, quase todos
    // `await` sem ler o retorno — ver `grep upsertPipeEntry(`).
    console.warn(
      `[pipeline-adapter] upsertPipeEntry abortado: leitura de pipeline_entries falhou para pipeline=${pipelineId} lead=${params.leadId}. Não inserimos às cegas para não duplicar negócio.`,
    );
    return { status: "read_failed" };
  }

  if (read.rows.length > 1) {
    console.warn(
      `[pipeline-adapter] upsertPipeEntry encontrou ${read.rows.length} entries para pipeline=${pipelineId} lead=${params.leadId}; atualizando a escolhida por pickActiveEntry em vez de inserir outra.`,
    );
  }

  const existing = pickActiveEntry(read.rows);

  if (existing) {
    const up: Record<string, unknown> = { stage_key: params.stageKey };
    if (params.metadata) {
      up.metadata = { ...(existing.metadata || {}), ...params.metadata };
    }
    if (params.assignedTo !== undefined) up.assigned_to = params.assignedTo;
    if (params.notes !== undefined) up.notes = params.notes;

    const { error } = await supabase
      .from("pipeline_entries")
      .update(up)
      .eq("id", existing.id);

    if (error) {
      console.warn("[pipeline-adapter] upsertPipeEntry update error:", error);
      return { status: "write_failed" };
    }
    return { status: "updated", entryId: existing.id };
  }

  // Aqui era o gate de `deal_manual_only` (ADR-0023 decisão 3), removido em
  // #1774: o INSERT é incondicional de novo. O ADR-0030 §2 restringiu aquela
  // decisão — quem autoriza a criação é a ferramenta que chamou (Workflow ativo,
  // chave de API escopada), não uma flag por organização.

  const { data, error } = await supabase
    .from("pipeline_entries")
    .insert({
      pipeline_id: pipelineId,
      lead_id: params.leadId,
      organization_id: params.orgId,
      stage_key: params.stageKey,
      assigned_to: params.assignedTo ?? null,
      notes: params.notes ?? null,
      metadata: params.metadata || {},
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[pipeline-adapter] upsertPipeEntry insert error:", error);
    return { status: "write_failed" };
  }
  return data?.id ? { status: "created", entryId: data.id } : { status: "write_failed" };
}

export async function updatePipeEntryById(
  supabase: SupabaseClient,
  entryId: string,
  updates: {
    stageKey?: string;
    metadata?: Record<string, unknown>;
    assignedTo?: string | null;
    notes?: string | null;
    closedAt?: string | null;
  },
): Promise<boolean> {
  const payload: Record<string, unknown> = {};
  if (updates.stageKey !== undefined) payload.stage_key = updates.stageKey;
  if (updates.assignedTo !== undefined) payload.assigned_to = updates.assignedTo;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.closedAt !== undefined) payload.closed_at = updates.closedAt;

  if (updates.metadata !== undefined) {
    const { data: current } = await supabase
      .from("pipeline_entries")
      .select("metadata")
      .eq("id", entryId)
      .single();
    payload.metadata = {
      ...((current?.metadata as Record<string, unknown>) || {}),
      ...updates.metadata,
    };
  }

  if (Object.keys(payload).length === 0) return true;

  const { error } = await supabase
    .from("pipeline_entries")
    .update(payload)
    .eq("id", entryId);

  if (error) {
    console.warn(`[pipeline-adapter] updatePipeEntryById error for ${entryId}:`, error);
    return false;
  }
  return true;
}

export async function deletePipeEntry(
  supabase: SupabaseClient,
  leadId: string,
  orgId: string,
  slug: PipeSlug,
): Promise<boolean> {
  const pipelineId = await resolvePipelineId(supabase, orgId, slug);
  if (!pipelineId) return false;

  const { error } = await supabase
    .from("pipeline_entries")
    .delete()
    .eq("pipeline_id", pipelineId)
    .eq("lead_id", leadId);

  if (error) {
    console.warn("[pipeline-adapter] deletePipeEntry error:", error);
    return false;
  }
  return true;
}
