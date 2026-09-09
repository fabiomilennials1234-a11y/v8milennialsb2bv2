/**
 * Configurações da organização (ex.: dias para considerar atrasado no pipe de confirmação).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useIdentity } from "../../auth/hooks/useIdentity";

const DEFAULT_OVERDUE_DAYS = 5;
const DEFAULT_REORDER_CYCLE_DAYS = 30;

export interface OrganizationSettings {
  confirmacao_overdue_days: number;
  default_reorder_cycle_days: number;
  /**
   * Funil padrão da org (SCRUM-624, ADR-0034 D4): fallback único das portas de
   * entrada sem destino declarado (ex.: lead-webhook sem place_in_pipe).
   * NULL = sem padrão — lead entra sem card.
   */
  default_pipeline_id: string | null;
}

export function useOrganizationSettings() {
  const { organizationId, isReady } = useOrganization();
  const { isAdmin } = useIdentity();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["organization-settings", organizationId],
    queryFn: async (): Promise<OrganizationSettings> => {
      if (!organizationId) {
        return { confirmacao_overdue_days: DEFAULT_OVERDUE_DAYS, default_reorder_cycle_days: DEFAULT_REORDER_CYCLE_DAYS, default_pipeline_id: null };
      }
      const { data, error } = await supabase
        .from("organizations")
        // default_pipeline_id: coluna da 20270908004000 — cast até o próximo
        // `supabase gen types` pós-apply (precedente: default_reorder_cycle_days).
        .select("confirmacao_overdue_days, default_reorder_cycle_days, default_pipeline_id" as "confirmacao_overdue_days, default_reorder_cycle_days")
        .eq("id", organizationId)
        .single();

      if (error) {
        if (error.code === "PGRST116" || error.message?.includes("column")) {
          return { confirmacao_overdue_days: DEFAULT_OVERDUE_DAYS, default_reorder_cycle_days: DEFAULT_REORDER_CYCLE_DAYS, default_pipeline_id: null };
        }
        throw error;
      }

      const days = data?.confirmacao_overdue_days;
      const cycleDays = (data as any)?.default_reorder_cycle_days;
      const defaultPipelineId = (data as any)?.default_pipeline_id;
      return {
        confirmacao_overdue_days:
          typeof days === "number" && days >= 1 && days <= 365 ? days : DEFAULT_OVERDUE_DAYS,
        default_reorder_cycle_days:
          typeof cycleDays === "number" && cycleDays >= 1 && cycleDays <= 365 ? cycleDays : DEFAULT_REORDER_CYCLE_DAYS,
        default_pipeline_id: typeof defaultPipelineId === "string" ? defaultPipelineId : null,
      };
    },
    enabled: isReady && !!organizationId,
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: Partial<{ confirmacao_overdue_days: number; default_reorder_cycle_days: number; default_pipeline_id: string | null }>) => {
      if (!organizationId) throw new Error("Sem organização");
      const update: Record<string, number | string | null> = {};
      if (payload.confirmacao_overdue_days != null) {
        update.confirmacao_overdue_days = Math.min(365, Math.max(1, payload.confirmacao_overdue_days));
      }
      if (payload.default_reorder_cycle_days != null) {
        update.default_reorder_cycle_days = Math.min(365, Math.max(1, payload.default_reorder_cycle_days));
      }
      // `null` explícito é válido: limpa o funil padrão (org fica "sem padrão").
      if ("default_pipeline_id" in payload) {
        update.default_pipeline_id = payload.default_pipeline_id ?? null;
      }
      // Escrita vai por RPC, não pela tabela. `organizations` NÃO tem policy de
      // UPDATE para não-master, e isso é proteção, não esquecimento: a tabela
      // guarda subscription_plan, payment_customer_id, billing_override,
      // limit_overrides, feature_flags e elevenlabs_api_key. Abrir UPDATE para
      // admin seria escalação de privilégio.
      //
      // Medido em prod (2026-09-04): admin fazia SELECT 1 linha e UPDATE 0
      // linhas; o `.single()` então estourava PGRST116 e TODA configuração de
      // org ficava ingravável para admin — inclusive o funil padrão, que é o
      // passo 1 da exclusão de funil ("Erro ao excluir funil").
      //
      // `set_org_settings` é DEFINER com allowlist explícita de 3 chaves e
      // autorização admin-da-org-ou-master, no molde de set_org_chat_restriction.
      // `as never` no nome: a RPC é da 20271002000000 e ainda não está nos tipos
      // gerados. Sai junto com o próximo `supabase gen types`. Não vale importar
      // o helper de outro módulo por isso — seria deep-import cross-module, que
      // o boundaries recusa.
      const { data, error } = await supabase.rpc(
        "set_org_settings" as never,
        { p_org_id: organizationId, p_patch: update } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-settings", organizationId] });
    },
  });

  return {
    settings: query.data ?? { confirmacao_overdue_days: DEFAULT_OVERDUE_DAYS, default_reorder_cycle_days: DEFAULT_REORDER_CYCLE_DAYS, default_pipeline_id: null },
    isLoading: query.isLoading,
    isAdmin,
    updateSettings: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}

/**
 * Dias sem interação para considerar um item do pipe de confirmação como "atrasado".
 * Usar em stats, filtros e indicadores.
 */
export function useConfirmacaoOverdueDays(): number {
  const { settings } = useOrganizationSettings();
  return settings.confirmacao_overdue_days;
}

/**
 * Verifica se um item do pipe de confirmação está atrasado (X dias sem interação).
 * Não considera compareceu/perdido.
 */
export function isConfirmacaoOverdue(
  status: string,
  updatedAt: string | null | undefined,
  overdueDays: number
): boolean {
  if (["compareceu", "perdido"].includes(status)) return false;
  if (!updatedAt) return false;
  const updated = new Date(updatedAt);
  const limit = new Date();
  limit.setDate(limit.getDate() - overdueDays);
  return updated <= limit;
}
