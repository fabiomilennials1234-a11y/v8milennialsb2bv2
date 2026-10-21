import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIdentity, useOrganization } from "@/modules/identity";
import { canEditLossReasons, LOSS_REASON_NAME_MAX_LENGTH } from "../../lib/loss-reason-settings";

// Definição canônica em contracts. Re-exportada aqui (API pública inalterada).
import type { LossReason } from "@/contracts/pipe";
export type { LossReason };

export function useLossReasons() {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["loss_reasons", organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("loss_reasons")
        .select("*")
        .eq("organization_id", organizationId)
        .order("display_order");
      if (error) throw error;
      return data as LossReason[];
    },
    enabled: !!organizationId,
  });
}

/** Renomeia a linha existente: IDs, categoria e histórico permanecem intactos. */
export function useRenameLossReason() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  const { isAdmin } = useIdentity();
  return useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      if (!organizationId || !canEditLossReasons(organizationId, isAdmin)) {
        throw new Error("Edição indisponível para esta organização ou usuário.");
      }
      const name = input.name.trim();
      if (!name || name.length > LOSS_REASON_NAME_MAX_LENGTH) {
        throw new Error(`Informe um nome com até ${LOSS_REASON_NAME_MAX_LENGTH} caracteres.`);
      }
      const { data, error } = await supabase.from("loss_reasons")
        .update({ name })
        .eq("organization_id", organizationId)
        .eq("id", input.id)
        .select("id, name, organization_id")
        .single();
      // .single() também acusa RLS/linha ausente: zero linhas não é sucesso.
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => qc.invalidateQueries({ queryKey: ["loss_reasons", data.organization_id] }),
  });
}

export function useCreateLossReason() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  return useMutation({
    mutationFn: async (input: { name: string; slug: string; category?: string }) => {
      const { data, error } = await (supabase.from as any)("loss_reasons")
        .insert({ ...input, organization_id: organizationId })
        .select()
        .single();
      if (error) throw error;
      return data as LossReason;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loss_reasons"] }),
  });
}

export function useDeleteLossReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from as any)("loss_reasons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loss_reasons"] }),
  });
}
