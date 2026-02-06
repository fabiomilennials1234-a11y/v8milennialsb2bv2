/**
 * Configurações da organização (ex.: dias para considerar atrasado no pipe de confirmação).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useIsAdmin } from "./useUserRole";

const DEFAULT_OVERDUE_DAYS = 5;

export interface OrganizationSettings {
  confirmacao_overdue_days: number;
}

export function useOrganizationSettings() {
  const { organizationId, isReady } = useOrganization();
  const { isAdmin } = useIsAdmin();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["organization-settings", organizationId],
    queryFn: async (): Promise<OrganizationSettings> => {
      if (!organizationId) {
        return { confirmacao_overdue_days: DEFAULT_OVERDUE_DAYS };
      }
      const { data, error } = await supabase
        .from("organizations")
        .select("confirmacao_overdue_days")
        .eq("id", organizationId)
        .single();

      if (error) {
        // Coluna pode não existir ainda (migration não rodou)
        if (error.code === "PGRST116" || error.message?.includes("column")) {
          return { confirmacao_overdue_days: DEFAULT_OVERDUE_DAYS };
        }
        throw error;
      }

      const days = data?.confirmacao_overdue_days;
      return {
        confirmacao_overdue_days:
          typeof days === "number" && days >= 1 && days <= 365 ? days : DEFAULT_OVERDUE_DAYS,
      };
    },
    enabled: isReady && !!organizationId,
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { confirmacao_overdue_days: number }) => {
      if (!organizationId) throw new Error("Sem organização");
      const { data, error } = await supabase
        .from("organizations")
        .update({
          confirmacao_overdue_days: Math.min(365, Math.max(1, payload.confirmacao_overdue_days)),
        })
        .eq("id", organizationId)
        .select("confirmacao_overdue_days")
        .single();
      if (error) throw error;
      return data as { confirmacao_overdue_days: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-settings", organizationId] });
    },
  });

  return {
    settings: query.data ?? { confirmacao_overdue_days: DEFAULT_OVERDUE_DAYS },
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
