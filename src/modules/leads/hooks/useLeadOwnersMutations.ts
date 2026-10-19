import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isHumanPortugueseMessage } from "@/shared/errors";
import { LEAD_RESPONSIBLE_MAP_KEY } from "./useLeads";
import { leadOwnersKey } from "./useLeadOwners";

/**
 * Escrita de donos do lead (Chamado 793f4b05 · PR3).
 *
 * O banco (PR1) é a fonte da regra: `lead_owner_add | remove | transfer` são
 * SECURITY DEFINER e conferem sessão, org, flag `lead_owners_n_donos` e o poder
 * de editar o lead (`can_update_lead`); `lead_owners` não tem GRANT de escrita.
 * Aqui mora o que o front controla — argumentos, recusa em português e o que
 * relê depois de uma troca. Fica em arquivo próprio porque importa de
 * `useLeads`, que por sua vez importa a leitura (`useLeadOwners`): juntar os
 * dois fecharia um ciclo.
 *
 * Os hooks lançam o erro ORIGINAL do PostgREST (com `code`): quem mostra ao
 * usuário usa `notifyError(err, { fallback, message: recusaDeDonos(err) })`
 * (ADR-0038), que também relata o erro.
 */

const RECUSAS: Record<string, string> = {
  PT403: "Esta organização não usa mais de um dono por lead.",
  PT404: "Lead não encontrado. Atualize a ficha.",
  PT409: "Para tirar o dono principal, passe o lead para outra pessoa.",
  PT422: "Essa pessoa não pode ser dona deste lead.",
};

/**
 * Texto da recusa que o BANCO escreveu de propósito, ou `undefined` quando o
 * erro é outro (rede, 500, permissão genérica em inglês). A tela o passa como
 * `message` de `notifyError`; sem ele, cai no `fallback` do chamador. Nunca a
 * mensagem técnica.
 */
export function recusaDeDonos(
  error: { code?: string; message?: string } | null | undefined,
): string | undefined {
  const code = error?.code;
  if (!code) return undefined;
  // 42501 cobre "sem sessão" e "não edita este lead": a frase do banco diz qual,
  // mas o mesmo código também vem do Postgres em inglês ("permission denied …").
  if (code === "42501") {
    return error?.message && isHumanPortugueseMessage(error.message) ? error.message : undefined;
  }
  return RECUSAS[code];
}

/**
 * Tudo que desenha dono precisa rereler depois de uma troca: a ficha, a lista,
 * o funil, o inbox e os próprios donos. Strings literais de propósito —
 * importar as chaves de `modules/pipelines` reabriria o ciclo leads↔pipelines.
 */
export function invalidarDonos(qc: QueryClient, leadId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: leadOwnersKey(leadId) }),
    qc.invalidateQueries({ queryKey: ["lead-detail", leadId] }),
    qc.invalidateQueries({ queryKey: ["lead-responsibles", leadId] }),
    qc.invalidateQueries({ queryKey: [LEAD_RESPONSIBLE_MAP_KEY] }),
    qc.invalidateQueries({ queryKey: ["leads"], refetchType: "active" }),
    qc.invalidateQueries({ queryKey: ["pipeline_entries"], refetchType: "active" }),
    qc.invalidateQueries({ queryKey: ["pipeline-page"], refetchType: "active" }),
  ]);
}

export function useAddLeadOwner(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teamMemberId: string): Promise<void> => {
      // Chamado NO objeto: `const rpc = supabase.rpc` perde o receiver.
      const { error } = await supabase.rpc("lead_owner_add", {
        p_lead_id: leadId,
        p_team_member_id: teamMemberId,
      });
      if (error) throw error;
    },
    onSettled: () => invalidarDonos(qc, leadId),
  });
}

export function useRemoveLeadOwner(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teamMemberId: string): Promise<void> => {
      const { error } = await supabase.rpc("lead_owner_remove", {
        p_lead_id: leadId,
        p_team_member_id: teamMemberId,
      });
      if (error) throw error;
    },
    onSettled: () => invalidarDonos(qc, leadId),
  });
}

export interface TransferLeadOwnerInput {
  toMemberId: string;
  role: "pre_venda" | "venda";
  /** O principal anterior continua como co-dono (padrão do CTO, 08/10). */
  keepPrevious: boolean;
}

export function useTransferLeadOwner(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ toMemberId, role, keepPrevious }: TransferLeadOwnerInput): Promise<void> => {
      const { error } = await supabase.rpc("lead_owner_transfer", {
        p_lead_id: leadId,
        p_to_member: toMemberId,
        p_role: role,
        p_keep_previous: keepPrevious,
      });
      if (error) throw error;
    },
    onSettled: () => invalidarDonos(qc, leadId),
  });
}
