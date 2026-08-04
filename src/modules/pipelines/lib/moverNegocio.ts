import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Avançar é MOVER, não copiar — ADR-0023 decisão 4.
 *
 * Até aqui, chegar na etapa de sucesso de um funil fazia DUAS escritas: um
 * UPDATE na etapa do card de origem e um INSERT de um card novo no destino. A
 * origem nunca saía, e o gêmeo ficava para trás — é ele que faz o mesmo lead
 * aparecer em Qualificação e em Orçamentos ao mesmo tempo (801 leads em prod,
 * medido 2026-08-03).
 *
 * Este módulo existe para que as quatro telas que fazem essa transição
 * convirjam num caminho só. Repetir a chamada em cada uma delas foi como o
 * defeito nasceu: hoje 3 dos 5 caminhos ignoram a configuração de
 * `pipeline_stages` e chumbam a etapa no código, então já divergem entre si.
 *
 * ── SÓ SISTEMA → SISTEMA ──────────────────────────────────────────────────
 * O destino ser um funil customizado é outro problema, e mais caro: card de
 * funil custom vive numa tabela diferente, espelhada por chave primária, e a
 * sincronia nunca reescreve o funil. Atravessar essa fronteira obriga apagar e
 * recriar — o negócio sobrevive, o card perde o id e leva o histórico junto.
 * A função no banco RECUSA esse destino em vez de fingir que resolve.
 */

export interface MoverNegocioParams {
  /** `pipeline_entries.id` — a POSIÇÃO que vai viajar. */
  entryId: string;
  targetPipelineId: string;
  targetStageKey: string;
  /**
   * A etapa de sucesso da ORIGEM, por onde o card passa antes de sair.
   *
   * É ela que produz `meeting_booked` e `meeting_held`: o gatilho de métrica
   * dispara na TRANSIÇÃO para `agendado`/`compareceu`, não na permanência. Um
   * move direto para o destino pularia as duas e 71 orgs parariam de contar
   * reunião no dia do deploy.
   *
   * Passe `null` **apenas** quando o chamador já fez esse UPDATE — que é o caso
   * das telas que precisam gravar responsável no mesmo passo.
   */
  stageOrigem?: string | null;
  assignedTo?: string | null;
}

/**
 * `as never` no nome e no payload: `mover_negocio` ainda não está nos tipos
 * gerados do Supabase, e regenerá-los a partir de branch efêmera corrompe o
 * arquivo (a branch não tem as versões órfãs de prod). Sai junto com o apply em
 * produção, num commit só — ver CLAUDE.md.
 */
export async function moverNegocio(params: MoverNegocioParams): Promise<void> {
  const { error } = await supabase.rpc("mover_negocio" as never, {
    p_entry_id: params.entryId,
    p_target_pipeline_id: params.targetPipelineId,
    p_target_stage_key: params.targetStageKey,
    p_stage_origem: params.stageOrigem ?? null,
    p_assigned_to: params.assignedTo ?? null,
  } as never);

  if (error) throw error;
}

/**
 * O que precisa recarregar depois de um move.
 *
 * Mover atravessa DOIS funis, então invalidar só o da tela deixa o outro board
 * mentindo até a janela perder e recuperar o foco. Prefixo de propósito: as
 * chaves carregam org, etapa e filtros que não dá para reconstruir aqui, e o
 * match parcial do TanStack v5 cobre todas as variantes montadas.
 *
 * `pipeline-stage-counts` e `custom_pipe_stage_counts` entram à parte porque o
 * badge da coluna não tem assinatura de realtime e tem `staleTime` de 30s — sem
 * isto o número da coluna fica errado mesmo com o card já no lugar certo. Mesmo
 * furo que `useCrossPipeMove` documenta.
 */
export function invalidateAfterMove(queryClient: QueryClient, leadId?: string): void {
  // Views de compatibilidade — as telas de funil ainda leem por elas.
  queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
  queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
  queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });

  // Boards e contadores de coluna.
  queryClient.invalidateQueries({ queryKey: ["pipeline-page"] });
  queryClient.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });
  queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });

  // Camada de negócio: a lista de Leads e o drawer leem daqui.
  queryClient.invalidateQueries({ queryKey: ["leads-deals"] });
  queryClient.invalidateQueries({ queryKey: ["leads-sales-metrics"] });

  if (leadId) {
    queryClient.invalidateQueries({ queryKey: ["lead_all_pipelines", leadId] });
    queryClient.invalidateQueries({ queryKey: ["lead-pipes", leadId] });
    queryClient.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
  }
}
