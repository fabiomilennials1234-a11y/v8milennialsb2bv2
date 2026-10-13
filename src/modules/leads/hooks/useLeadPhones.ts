import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  erroDeTelefone,
  leadPhoneFromRow,
  ordenarTelefones,
  type LeadPhone,
  type LeadPhoneRow,
} from "../lib/lead-phones";
import { extractSearchDigits } from "../lib/lead-list-filters";

/**
 * Telefones (contatos nomeados) do lead — Chamado 82c50502.
 *
 * Leitura direta em `lead_phones` (RLS herda a visibilidade do lead). Escrita
 * SEMPRE pelas RPCs: `salvar_telefones_do_lead` (lista completa, soft delete do
 * que saiu, troca de principal via `leads.phone`), `nomear_contato_do_telefone`
 * e `definir_telefone_do_negocio`.
 */
export const leadPhonesKey = (leadId: string | null) => ["lead-phones", leadId] as const;

const SELECT = "id, phone, normalized_phone, label, label_locked, is_primary, is_whatsapp, source";

export function useLeadPhones(leadId: string | null, enabled = true) {
  return useQuery({
    queryKey: leadPhonesKey(leadId),
    enabled: enabled && !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<LeadPhone[]> => {
      const { data, error } = await supabase
        .from("lead_phones")
        .select(SELECT)
        .eq("lead_id", leadId!)
        .is("deleted_at", null);
      if (error) throw error;
      return ordenarTelefones(((data ?? []) as LeadPhoneRow[]).map(leadPhoneFromRow));
    },
  });
}

/** Teto de leads trazidos pelo telefone secundário — a busca é por um número. */
const TETO_BUSCA_SECUNDARIA = 200;

/**
 * Pré-consulta da busca da lista de Leads: ids dos leads cujo telefone
 * SECUNDÁRIO casa com os dígitos digitados (Chamado 82c50502). Sem termo de
 * telefone, não consulta nada. Falha de leitura degrada para "sem secundário"
 * — a busca por nome/principal continua funcionando.
 */
export async function buscarLeadIdsPorTelefoneSecundario(
  organizationId: string,
  search: string | null | undefined,
): Promise<string[]> {
  const digits = search?.trim() ? extractSearchDigits(search.trim()) : null;
  if (!digits) return [];
  const { data, error } = await supabase
    .from("lead_phones")
    .select("lead_id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .ilike("normalized_phone", `%${digits}%`)
    .limit(TETO_BUSCA_SECUNDARIA);
  if (error) return [];
  return [...new Set(((data ?? []) as { lead_id: string }[]).map((r) => r.lead_id))];
}

export interface TelefoneEditado {
  id?: string;
  phone: string;
  label: string | null;
  isPrimary: boolean;
}

/** Invalida tudo que mostra telefone ou nome de contato. */
function invalidarTelefones(qc: ReturnType<typeof useQueryClient>, leadId: string | null) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: leadPhonesKey(leadId) }),
    // A ficha (telefone principal) e o chat (nome "Cód - Contato - Lead").
    qc.invalidateQueries({ queryKey: ["lead-detail", leadId] }),
    qc.invalidateQueries({ queryKey: ["contatos-das-conversas"] }),
    qc.invalidateQueries({ queryKey: ["whatsapp-contacts"] }),
  ]);
}

export function useSalvarTelefonesDoLead(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (telefones: TelefoneEditado[]): Promise<void> => {
      if (!leadId) throw new Error("Lead não encontrado. Atualize a ficha.");
      // Chamado NO objeto: `const rpc = supabase.rpc` perde o receiver.
      const { error } = await supabase.rpc("salvar_telefones_do_lead", {
        p_lead_id: leadId,
        p_phones: telefones.map((t) => ({
          ...(t.id ? { id: t.id } : {}),
          phone: t.phone.trim(),
          label: t.label?.trim() || null,
          is_primary: t.isPrimary,
        })),
      });
      if (error) throw erroDeTelefone(error);
    },
    onSettled: () => invalidarTelefones(qc, leadId),
  });
}

export function useNomearContatoDoTelefone(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ phone, label }: { phone: string; label: string | null }): Promise<void> => {
      if (!leadId) throw new Error("Lead não encontrado. Atualize a ficha.");
      const { error } = await supabase.rpc("nomear_contato_do_telefone", {
        p_lead_id: leadId,
        p_phone: phone,
        p_label: label?.trim() || null,
      } as never);
      if (error) throw erroDeTelefone(error);
    },
    onSettled: () => invalidarTelefones(qc, leadId),
  });
}

export function useDefinirTelefoneDoNegocio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, leadPhoneId }: { dealId: string; leadPhoneId: string }): Promise<void> => {
      const { error } = await supabase.rpc("definir_telefone_do_negocio", {
        p_deal_id: dealId,
        p_lead_phone_id: leadPhoneId,
      });
      if (error) throw erroDeTelefone(error);
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["deal-card-extras"] }),
        qc.invalidateQueries({ queryKey: ["deal-lead-phone"] }),
      ]),
  });
}
