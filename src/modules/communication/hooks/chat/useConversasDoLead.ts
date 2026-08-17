/**
 * `useConversasDoLead` — por caixa da org, a última mensagem trocada com um
 * telefone. É o dado do seletor de Conversa do Lead.
 *
 * Consome a RPC `get_conversas_do_lead` (migration 20270817140000), que é
 * `SECURITY INVOKER`: a RLS do chamador é quem recorta, e a org nunca vai por
 * parâmetro.
 *
 * Custo medido em produção (#1610), lead com 1811 mensagens em 3 caixas:
 * 0,27 ms e 23 buffers, contra 618 ms antes do índice
 * `idx_whatsapp_msgs_org_phone_instance_ts`. Barato o bastante para disparar
 * no hover do botão.
 *
 * A lista sai COMPLETA — inclusive caixas onde o usuário não pode escrever.
 * `whatsapp_instance_allowed_members` governa escrita, não leitura, e as
 * decisões 5 e 6 do mapa #1605 mandam a caixa aparecer, em modo leitura, com
 * o motivo. Quem rotula é a UI.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/normalizePhone";
import { useCurrentTeamMember } from "@/modules/identity";
import type { ConversaDoLeadRow } from "@/modules/communication/lib/agruparConversasDoLead";

/** Forma crua da RPC — snake_case, como o Postgres devolve. */
interface RpcRow {
  instance_id: string;
  instance_name: string;
  instance_status: string;
  last_message_at: string | null;
  last_message_content: string | null;
  last_message_direction: string | null;
}

export function useConversasDoLead(phone: string | null | undefined) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const target = normalizePhone(phone ?? null);

  return useQuery<ConversaDoLeadRow[]>({
    // `organizationId` entra na chave porque master em shadow troca de org sem
    // desmontar a árvore — sem isso o cache serviria a lista da org anterior.
    queryKey: ["conversas-do-lead", organizationId, target],
    queryFn: async () => {
      if (!target) return [];

      // `p_organization_id` é OBRIGATÓRIO e vem daqui, não do servidor: só o
      // cliente sabe qual org o shadow do master selecionou. A primeira versão
      // derivava no servidor com `get_my_organization_ids()` e por isso listava
      // caixa de TODAS as orgs do usuário — em produção, 14 orgs e 69 caixas.
      //
      // `as any` no nome da RPC: `types.ts` é gerado e ainda não conhece esta
      // função. Some quando alguém rodar `supabase gen types`.
      const { data, error } = await (supabase as any).rpc("get_conversas_do_lead", {
        p_phone: target,
        p_organization_id: organizationId,
      });
      if (error) throw error;

      return ((data ?? []) as RpcRow[]).map((r) => ({
        instanceId: r.instance_id,
        instanceName: r.instance_name,
        instanceStatus: r.instance_status,
        lastMessageAt: r.last_message_at,
        lastMessageContent: r.last_message_content,
        lastMessageDirection: r.last_message_direction,
      }));
    },
    enabled: !!organizationId && !!target,
    staleTime: 30_000,
  });
}
