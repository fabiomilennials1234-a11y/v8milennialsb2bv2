/**
 * Hooks master — fila de revisão de stage_role won/lost (#991, ADR-0017 §1).
 *
 * Cross-org de propósito (padrão master ops): a policy
 * `master_all_pipeline_stages` (FOR ALL USING is_master_user()) autoriza ler
 * e gravar `pipeline_stages` de qualquer organização. Nenhum caminho aqui
 * aplica won/lost sem a decisão explícita do master — o payload sai de
 * `buildReviewUpdate` (puro, testado em unit).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "../../auth/contexts/AuthContext";
import { toast } from "sonner";
import {
  buildReviewUpdate,
  type ReviewAction,
  type StageRoleSuggestionRow,
} from "../lib/stage-role-review";
import { nomeDoFunil } from "@/contracts/pipe";
import type { StageRole, SystemPipeDisplay } from "@/contracts/pipe";

const QUERY_KEY = ["master-stage-role-suggestions"] as const;

/** Fila completa de sugestões won/lost pendentes, todas as orgs. */
export function useStageRoleSuggestions() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<StageRoleSuggestionRow[]> => {
      // Duas leituras em paralelo: a fila + o display config de TODAS as
      // orgs (policy master_ghost_select_pipeline_display_config). O rótulo
      // do funil precisa ser o nome que a ORG usa — nunca o catálogo
      // ("Qualificação"/"Confirmação"/"Propostas" são o seed congelado que
      // nenhuma navegação mostra). Mesma regra de nome do resto do app:
      // `nomeDoFunil` (@/contracts/pipe).
      type RawRow = Omit<StageRoleSuggestionRow, "funil_label">;
      const [fila, configs] = await Promise.all([
        supabase
          .from("pipeline_stages")
          .select(
            "id, organization_id, pipeline_type, stage_key, name, color, stage_role, suggested_stage_role, stage_role_suggested_at, stage_role_suggestion_source, organization:organizations(name), pipeline:pipelines(name, slug, type)",
          )
          .in("suggested_stage_role", ["won", "lost"])
          .eq("is_active", true)
          .order("organization_id")
          .returns<RawRow[]>(),
        supabase
          .from("pipeline_display_config")
          .select("organization_id, pipe_type, display_name, is_visible, position")
          .returns<(SystemPipeDisplay & { organization_id: string })[]>(),
      ]);

      if (fila.error) throw fila.error;
      if (configs.error) throw configs.error;

      const configsPorOrg = new Map<string, SystemPipeDisplay[]>();
      for (const c of configs.data ?? []) {
        const lista = configsPorOrg.get(c.organization_id) ?? [];
        lista.push(c);
        configsPorOrg.set(c.organization_id, lista);
      }

      return (fila.data ?? []).map((row): StageRoleSuggestionRow => ({
        ...row,
        funil_label: row.pipeline
          ? nomeDoFunil(configsPorOrg.get(row.organization_id), row.pipeline)
          : null,
      }));
    },
    staleTime: 30 * 1000,
  });
}

export interface ReviewSuggestionInput {
  row: StageRoleSuggestionRow;
  action: ReviewAction;
  /** Obrigatório quando action = 'correct'. */
  correctedRole?: StageRole;
}

/** Aprovar / corrigir / dispensar uma sugestão — a confirmação humana. */
export function useReviewStageRoleSuggestion() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ row, action, correctedRole }: ReviewSuggestionInput) => {
      if (!user?.id) throw new Error("Sessão master não encontrada");

      const update = buildReviewUpdate({
        action,
        suggestedRole: row.suggested_stage_role,
        correctedRole,
        reviewerId: user.id,
      });

      const { error } = await supabase
        .from("pipeline_stages")
        .update(update)
        .eq("id", row.id);

      if (error) throw error;
      return { action };
    },
    onSuccess: ({ action }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success(
        action === "approve"
          ? "Sugestão aprovada — role aplicado"
          : action === "correct"
            ? "Role corrigido e aplicado"
            : "Sugestão dispensada — etapa segue sem role terminal",
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao revisar sugestão");
    },
  });
}
