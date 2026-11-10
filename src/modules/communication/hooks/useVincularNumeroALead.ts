import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { notifyError } from "@/shared/errors";

/** Flag por org (`organizations.feature_flags`). */
export const FLAG_VINCULAR_CLIENTE_EXISTENTE = "chat_vincular_cliente_existente";

/**
 * Liga a conversa de um número a um cliente que JÁ existe (migration
 * 20280111000000): o número vira telefone do cadastro e a conversa é
 * religada. As próximas mensagens do número já chegam no cliente.
 *
 * `as never`: RPC mais nova que o types.ts gerado de prod; morre no regen.
 */
export function useVincularNumeroALead() {
  const { organizationId } = useOrganization();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { phone: string; leadId: string; leadName?: string | null }) => {
      if (!organizationId) throw new Error("Organização não carregada.");
      const { error } = await supabase.rpc("vincular_numero_a_lead" as never, {
        p_organization_id: organizationId,
        p_phone: input.phone,
        p_lead_id: input.leadId,
      } as never);
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      // A ficha acha o lead pelo telefone; a lista do chat lê o vínculo do resumo.
      void qc.invalidateQueries({ queryKey: ["lead_by_phone"] });
      void qc.invalidateQueries({ queryKey: ["whatsapp_conversations"] });
      void qc.invalidateQueries({ queryKey: ["whatsapp_messages"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success(`Conversa vinculada a ${input.leadName || "cliente"}`);
    },
    onError: (err: Error) => notifyError(err, { fallback: "Não foi possível vincular a conversa." }),
  });
}
