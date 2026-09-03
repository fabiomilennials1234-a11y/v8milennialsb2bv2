import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * @deprecated SCRUM-633 — era o caminho por slug dos 3 pipes de sistema
 * (RPC `bulk_move_stage`, hoje wrapper fino sobre o motor único — ver
 * 20270908003000). Sem consumidor no front; morre na W6 junto do wrapper.
 * Use {@link useBulkMoveToPipeline}.
 */
export function useBulkMoveStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      lead_ids: string[];
      target_pipe: string;
      target_stage: string;
    }) => {
      const { data, error } = await supabase.rpc("bulk_move_stage" as any, {
        p_lead_ids: params.lead_ids,
        p_target_pipe: params.target_pipe,
        p_target_stage: params.target_stage,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/**
 * Mover/adicionar leads em massa a QUALQUER funil por `pipeline_id` + etapa
 * (uuid de `pipeline_stages`) — o motor único `bulk_add_to_pipeline` da
 * migration 20270908003000 (SCRUM-626): move os negócios ABERTOS do lead no
 * funil alvo (won/lost intocados) ou abre um novo quando não há aberto.
 * Autorização server-side (SECURITY DEFINER: org do membro / master).
 */
export function useBulkMoveToPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lead_ids,
      pipeline_id,
      stage_id,
    }: {
      lead_ids: string[];
      pipeline_id: string;
      stage_id: string;
    }) => {
      const { data, error } = await supabase.rpc("bulk_add_to_pipeline" as any, {
        p_lead_ids: lead_ids,
        p_pipeline_id: pipeline_id,
        p_stage_id: stage_id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Boards novos (pipeline-page/counts) + espelhos legados ainda montados.
      qc.invalidateQueries({ queryKey: ["pipeline-page"] });
      qc.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });
      qc.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/**
 * @deprecated SCRUM-633 — alias de compat; use {@link useBulkMoveToPipeline}.
 * O nome "custom" mentia desde a SCRUM-626: o motor serve qualquer funil.
 */
export const useBulkMoveToCustomPipe = useBulkMoveToPipeline;

export function useBulkAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      lead_ids: string[];
      responsible_id: string | null;
      sdr_id: string | null;
      closer_id: string | null;
    }) => {
      const { data, error } = await supabase.rpc("bulk_assign_leads" as any, {
        p_lead_ids: params.lead_ids,
        p_responsible_id: params.responsible_id,
        p_sdr_id: params.sdr_id,
        p_closer_id: params.closer_id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useBulkTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      lead_ids: string[];
      add_tag_ids: string[];
      remove_tag_ids: string[];
    }) => {
      const { data, error } = await supabase.rpc("bulk_tag_leads" as any, {
        p_lead_ids: params.lead_ids,
        p_add_tag_ids: params.add_tag_ids,
        p_remove_tag_ids: params.remove_tag_ids,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useBulkDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { lead_ids: string[] }) => {
      const { data, error } = await supabase.rpc("bulk_delete_leads" as any, {
        p_lead_ids: params.lead_ids,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["trash_leads"] });
    },
  });
}

/**
 * Excluir os NEGÓCIOS selecionados de um funil — não as pessoas.
 *
 * ── POR QUE ESTE HOOK EXISTE (SCRUM-611) ──────────────────────────────────
 * A barra de seleção em massa é a MESMA na lista de Leads e no kanban de
 * funil. Na lista, o que está marcado é uma pessoa e `useBulkDelete` está
 * certo. No kanban, o que está marcado é um NEGÓCIO — e a barra oferecia
 * "Excluir", que mandava a pessoa para a lixeira: ela sumia da lista de Leads,
 * de todos os outros funis, da carteira e do chat. Quem clicou tinha marcado
 * um card de negócio e não tinha por que ler "leads" no diálogo.
 *
 * O caminho de UM card só sempre fez o certo (`⋯ > Excluir negócio` apaga a
 * entry e preserva a pessoa). Este hook é aquele caminho, N vezes.
 *
 * ── POR QUE `pipeline_entries` E SÓ ELA ───────────────────────────────────
 * Desde a inversão do silo custom (migration 20270908001000)
 * `custom_pipe_entries` deixou de ser tabela e virou VIEW sobre
 * `pipeline_entries`, com `INSTEAD OF DELETE`. Ou seja: `pipeline_entries` é
 * canônica para as DUAS famílias, e apagar aqui é completo. Antes daquela
 * migration não era — apagar só o espelho deixava a linha custom viva e o card
 * voltava no refetch seguinte.
 *
 * ── ESCOPO: SEMPRE PRESO A UM FUNIL ───────────────────────────────────────
 * O `pipeline_id` não é opcional de propósito. Sem ele, isto apagaria o lead de
 * TODOS os funis — que é justamente o excesso que a SCRUM-611 relata, só que
 * com outro nome.
 *
 * ⚠️ A seleção do kanban é chaveada por `lead_id`, não por `entry_id`. Lead com
 * dois negócios no MESMO funil tem os dois apagados por um clique. É a
 * semântica honesta do que a seleção sabe hoje; corrigir de verdade exige
 * chavear a seleção por entry, que é fatia própria.
 */
export function useBulkRemoverNegocios() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { lead_ids: string[]; pipeline_id: string }) => {
      if (!params.pipeline_id) {
        throw new Error("pipeline_id é obrigatório — sem ele a exclusão vazaria para outros funis");
      }
      if (params.lead_ids.length === 0) return 0;

      // `.select()` depois do DELETE: um DELETE que a RLS recusa NÃO devolve
      // erro no PostgREST — devolve 0 linhas, e o cliente comemora. É a forma
      // mais comum de "o botão não faz nada" sobreviver em produção.
      const { data, error } = await supabase
        .from("pipeline_entries")
        .delete()
        .eq("pipeline_id", params.pipeline_id)
        .in("lead_id", params.lead_ids)
        .select("id");

      if (error) throw error;
      return (data ?? []).length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
