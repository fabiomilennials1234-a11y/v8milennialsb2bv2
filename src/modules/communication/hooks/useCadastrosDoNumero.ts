/**
 * Número de WhatsApp em 2+ cadastros (mesmo cliente com PF, PJ, filiais…).
 *
 * `useLeadByPhone` devolve só o lead resolvido, e o cache dele (`lead_by_phone`)
 * é editado no lugar por 8 atualizações otimistas de `useLeads` que esperam a
 * linha do lead — mudar a forma dele quebraria todas. Os candidatos moram aqui,
 * em query própria, montada SÓ quando a conversa ficou sem lead.
 *
 * A escolha do usuário vai para `escolher_lead_do_numero` (migration
 * 20280102000000): grava a escolha para o número e vincula a ele as mensagens
 * que estavam sem lead. A partir daí trigger, borda e front resolvem o número
 * para esse lead (regra 2a de `lib/leadByPhone.ts`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { normalizePhone } from "@/lib/normalizePhone";
import { resolveLeadByPhone } from "@/modules/communication/lib/leadByPhone";

export interface CadastroDoNumero {
  id: string;
  name: string;
  company: string | null;
  erp_code: string | null;
}

export interface CadastrosDoNumero {
  /** Lead que a regra resolveu (null = conversa sem lead). */
  leadId: string | null;
  /** Cadastros vivos com o número que o usuário enxerga. Vazio se < 2. */
  cadastros: CadastroDoNumero[];
}

export const numeroCadastrosKey = (organizationId: string | null, phone: string | null) =>
  ["numero_cadastros", organizationId, phone] as const;

/** Ordem estável: nome, depois código do ERP, depois id. */
function porNome(a: CadastroDoNumero, b: CadastroDoNumero): number {
  return (
    a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) ||
    (a.erp_code ?? "").localeCompare(b.erp_code ?? "", "pt-BR", { numeric: true }) ||
    a.id.localeCompare(b.id)
  );
}

export function useCadastrosDoNumero(phone: string | null, enabled = true) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const normalized = phone ? normalizePhone(phone) : null;

  return useQuery({
    queryKey: numeroCadastrosKey(organizationId, normalized),
    enabled: enabled && !!organizationId && !!normalized,
    queryFn: async (): Promise<CadastrosDoNumero> => {
      if (!organizationId || !normalized) return { leadId: null, cadastros: [] };

      const { leadId, candidateIds, error } = await resolveLeadByPhone(supabase, organizationId, normalized);
      if (error) throw new Error(error);
      if (candidateIds.length < 2) return { leadId, cadastros: [] };

      const { data, error: leadsError } = await supabase
        .from("leads")
        .select("id, name, company, erp_code")
        .eq("organization_id", organizationId)
        .in("id", candidateIds)
        .is("deleted_at", null);
      if (leadsError) throw leadsError;

      return { leadId, cadastros: ((data ?? []) as CadastroDoNumero[]).sort(porNome) };
    },
  });
}

export function useVincularConversaAoLead(phone: string | null) {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useMutation({
    mutationFn: async (leadId: string): Promise<number> => {
      if (!organizationId || !phone) throw new Error("Conversa sem organização ou número.");
      const { data, error } = await supabase.rpc("escolher_lead_do_numero", {
        p_organization_id: organizationId,
        p_phone: phone,
        p_lead_id: leadId,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["lead_by_phone"] }),
        qc.invalidateQueries({ queryKey: ["numero_cadastros"] }),
        // Lista de conversas (lead_id do resumo) e mensagens (lead_id por linha).
        qc.invalidateQueries({ queryKey: ["whatsapp_contacts"] }),
        qc.invalidateQueries({ queryKey: ["whatsapp_messages"] }),
        qc.invalidateQueries({ queryKey: ["whatsapp_conversations"] }),
      ]),
  });
}
