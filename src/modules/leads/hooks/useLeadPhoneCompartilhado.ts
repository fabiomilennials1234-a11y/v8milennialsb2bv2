import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { erroDeTelefone, ehPrincipalOcupado, mensagemDeDescompartilharOcupado } from "../lib/lead-phones";
import { buscarDonoDoNumero, leadPhoneCompartilhadoKey } from "./useLeadPhones";

/**
 * Número compartilhado entre leads (Chamado 99067f13, PR4).
 *
 * `leads.phone_compartilhado` só é marcado por UMA ação do usuário: confirmar o
 * diálogo de `useSalvarTelefonesDoLead`. Aqui ficam a leitura da marca e o
 * desfazer (`lead_phone_descompartilhar`).
 */
export { leadPhoneCompartilhadoKey };

export function useLeadPhoneCompartilhado(leadId: string | null, enabled = true) {
  return useQuery({
    queryKey: leadPhoneCompartilhadoKey(leadId),
    enabled: enabled && !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("leads")
        .select("phone_compartilhado")
        .eq("id", leadId!)
        .maybeSingle();
      if (error) throw error;
      return data?.phone_compartilhado === true;
    },
  });
}

export function useDescompartilharNumero(leadId: string | null) {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  return useMutation({
    /** `telefonePrincipal`: só para dizer QUEM segura o número se o banco recusar. */
    mutationFn: async ({ telefonePrincipal }: { telefonePrincipal: string | null }): Promise<void> => {
      if (!leadId) throw new Error("Lead não encontrado. Atualize a ficha.");
      // Chamado NO objeto: `const rpc = supabase.rpc` perde o receiver.
      const { error } = await supabase.rpc("lead_phone_descompartilhar", { p_lead_id: leadId });
      if (error) {
        if (ehPrincipalOcupado(error)) {
          const dono = await buscarDonoDoNumero(organizationId, leadId, telefonePrincipal);
          throw new Error(mensagemDeDescompartilharOcupado(dono));
        }
        throw erroDeTelefone(error);
      }
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: leadPhoneCompartilhadoKey(leadId) }),
        qc.invalidateQueries({ queryKey: ["lead-detail", leadId] }),
      ]),
  });
}
