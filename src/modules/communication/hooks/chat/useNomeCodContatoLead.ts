import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFeatureFlag } from "@/modules/platform/hooks/useFeatureFlag";

/**
 * Flag por org `chat_nome_cod_contato_lead` (Chamado 82c50502): toda conversa
 * de cliente (WhatsApp, não grupo) se chama `Cód - Contato - Lead` na lista, no
 * cabeçalho e no painel (ver `nomeCodContatoLead`). Vence `chat_nome_do_lead`,
 * que vence `chat_nome_do_whatsapp`.
 *
 * Fail-closed enquanto a flag carrega. É o ÚNICO lugar do código que conhece a
 * chave.
 */
export function useNomeCodContatoLead(): boolean {
  return useFeatureFlag("chat_nome_cod_contato_lead").enabled === true;
}

export interface FontesDoContatoDaConversa {
  nomeDoLead: string | null;
  erpCode: string | null;
  /** `lead_phones.label` do telefone da conversa. */
  contato: string | null;
  /** `lead_phones.id` do telefone da conversa, quando ele já está no lead. */
  leadPhoneId: string | null;
}

/**
 * Nome do lead, código do ERP e nome do contato do telefone DESTA conversa —
 * para o cabeçalho e o painel, que resolvem o lead por conta própria. A lista
 * recebe os mesmos campos em lote (`enriquecerContatos`); a regra de montar o
 * nome é uma só (`nomeCodContatoLead`).
 */
export function useContatoDaConversa(
  leadId: string | null | undefined,
  telefone: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["contatos-das-conversas", "uma", leadId ?? null, telefone ?? null],
    enabled: enabled && !!leadId && !!telefone,
    staleTime: 30_000,
    queryFn: async (): Promise<FontesDoContatoDaConversa> => {
      const [leadRes, contatoRes] = await Promise.all([
        supabase.from("leads").select("name, erp_code").eq("id", leadId!).maybeSingle(),
        // Chamado NO objeto: `const rpc = supabase.rpc` perde o receiver.
        supabase.rpc("contatos_das_conversas", { p_pairs: [{ lead_id: leadId!, phone: telefone! }] }),
      ]);
      if (leadRes.error) throw leadRes.error;
      // Sem o nome do contato a conversa ainda se chama "Cód - Lead": não derruba.
      const linha = contatoRes.error
        ? null
        : ((contatoRes.data ?? []) as Array<{ label: string | null; lead_phone_id: string }>)[0] ?? null;
      const lead = leadRes.data as { name: string | null; erp_code: string | null } | null;
      return {
        nomeDoLead: lead?.name ?? null,
        erpCode: lead?.erp_code ?? null,
        contato: linha?.label ?? null,
        leadPhoneId: linha?.lead_phone_id ?? null,
      };
    },
  });
}
