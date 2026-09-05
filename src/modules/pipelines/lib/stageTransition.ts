import { supabase } from "@/integrations/supabase/client";
import {
  createCustomPipelineEntry,
  updateCustomPipelineEntry,
} from "@/integrations/supabase/pipeline-entry-rpc";

/**
 * Teto de linhas lidas por `(pipeline_id, lead_id)` — espelha
 * `PIPELINE_ENTRY_READ_CAP` em `hooks/model/usePipelineEntries.ts`. Depois do M1
 * o par deixou de ser único, e sem teto um lead com muitas recompras viraria
 * leitura aberta num caminho de UI.
 */
const CUSTOM_PIPE_ENTRY_READ_CAP = 50;

/**
 * Lê TODAS as entries de `(pipeline_id, lead_id)` e devolve a que representa o
 * lead no funil — tolerando N linhas.
 *
 * Por que não `.maybeSingle()`: com mais de uma linha o postgrest-js **zera o
 * `data`** e devolve `PGRST116`, então "existem 2" fica indistinguível de "não
 * existe" — e o caller insere mais uma a cada chamada, virando duplicador
 * determinístico.
 *
 * Qual negócio é o corrente: o primeiro ABERTO; se todos estiverem fechados, o
 * mais recente. É a mesma regra de `pickActiveEntry`
 * (`supabase/functions/_shared/pipeline-adapter.ts`) e de
 * `readActivePipelineEntry` (`hooks/model/usePipelineEntries.ts`) de propósito —
 * kanban, Copilot e esta transição automática precisam concordar sobre QUAL
 * negócio é o corrente, senão a UI mostra um e a automação move outro.
 *
 * "Aberto" aqui vem do papel da etapa, não de `closed_at`: `custom_pipe_entries`
 * não tem essa coluna. `stage_role IN ('won','lost')` é o mesmo predicado que
 * `bulk_add_to_custom_pipe` usa no banco (migration `20270730000050`) e, como lá,
 * hoje é defensivo — nenhum funil custom em prod tem etapa won/lost.
 */
async function readActiveCustomPipeEntry(pipelineId: string, leadId: string) {
  const { data, error } = await supabase
    .from("custom_pipe_entries")
    .select("id, stage:custom_pipeline_stages(stage_role)")
    .eq("lead_id", leadId)
    .eq("pipeline_id", pipelineId)
    .order("stage_changed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(CUSTOM_PIPE_ENTRY_READ_CAP);

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length > 1) {
    // Sinal explícito de "existem N" — o que `.maybeSingle()` apagava.
    console.warn(
      `[custom_pipe_entries] ${rows.length} entries para pipeline=${pipelineId} lead=${leadId}; movendo a primeira ABERTA, ou a mais recente se todas estiverem fechadas.`,
    );
  }

  const isClosed = (row: (typeof rows)[number]) =>
    row.stage?.stage_role === "won" || row.stage?.stage_role === "lost";

  return rows.find((row) => !isClosed(row)) ?? rows[0] ?? null;
}

/**
 * Insere (ou move) um lead em um funil customizado como destino de transição
 * automática de uma etapa de sucesso.
 *
 * Move o negócio CORRENTE do lead no funil destino (ver
 * `readActiveCustomPipeEntry`) para a etapa destino; se o lead ainda não tem
 * negócio nesse funil, cria. Espelha o branch custom→custom de
 * `useMoveLeadInCustomPipe`.
 *
 * Segurança: `organizationId` vem do contexto de auth do chamador. As funções
 * compartilhadas escrevem em `pipeline_entries`; a RLS da base é o gate final.
 */
export async function upsertLeadIntoCustomPipe(params: {
  leadId: string;
  organizationId: string;
  targetPipelineId: string;
  targetStageId: string;
}): Promise<void> {
  const { leadId, organizationId, targetPipelineId, targetStageId } = params;
  const now = new Date().toISOString();

  // ⚠️ MUDANÇA DE COMPORTAMENTO deliberada: falha de leitura propaga em vez de
  // ser descartada. Antes o erro caía no ramo do INSERT; sem o unique derrubado
  // pelo M1, cada falha transitória de leitura criaria um negócio duplicado —
  // permanente e visível no kanban do cliente. Transição automática que falhou é
  // recuperável: o usuário refaz o movimento.
  const existingEntry = await readActiveCustomPipeEntry(targetPipelineId, leadId);

  if (existingEntry) {
    await updateCustomPipelineEntry(existingEntry.id, {
      stage_id: targetStageId,
      stage_changed_at: now,
    });
  } else {
    await createCustomPipelineEntry({
      leadId,
      organizationId,
      pipelineId: targetPipelineId,
      stageId: targetStageId,
      enteredAt: now,
      stageChangedAt: now,
    });
  }
}
