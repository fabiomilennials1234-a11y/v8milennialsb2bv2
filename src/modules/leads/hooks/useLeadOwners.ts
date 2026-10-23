import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFeatureFlag } from "@/modules/platform";
import { LEAD_OWNERS_EMBED, LEAD_OWNERS_FLAG, resolveLeadOwners, type LeadOwner, type LeadOwnerRow } from "../lib/lead-owners";

/**
 * N donos por lead ligado na org corrente (flag `lead_owners_n_donos`,
 * Chamado 793f4b05)? Falso enquanto a flag carrega: a tela de sempre é a queda
 * segura, e nenhuma org sem a flag paga leitura de `lead_owners`.
 */
export function useLeadOwnersEnabled(): boolean {
  const { enabled, isLoading } = useFeatureFlag(LEAD_OWNERS_FLAG);
  return !isLoading && enabled;
}

const PAGINA = 1000;

/**
 * Leads em que `memberId` é CO-dono, para o filtro "responsável" casar
 * qualquer dono. Só os co-donos: os principais já estão nas colunas de `leads`.
 *
 * Paginado porque o PostgREST corta em 1000 sem avisar. Erro SOBE: uma lista
 * vazia aqui esconderia leads do filtro em silêncio.
 *
 * Só chame em org com a flag — é quem decide se a leitura existe.
 */
export async function buscarLeadIdsCoDono(organizationId: string, memberId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await supabase
      .from("lead_owners")
      .select("lead_id")
      .eq("organization_id", organizationId)
      .eq("team_member_id", memberId)
      .eq("role", "co")
      .order("lead_id", { ascending: true })
      .range(offset, offset + PAGINA - 1);
    if (error) throw error;
    const linhas = (data ?? []) as { lead_id: string }[];
    for (const r of linhas) ids.add(r.lead_id);
    if (linhas.length < PAGINA) break;
  }
  return [...ids];
}

const UUID_DONO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Leads em que o dono filtrado é co-dono — só em org com N donos e com um
 * membro no filtro. Nas outras orgs devolve `undefined` sem tocar no banco.
 * Lista, contagem, cards e exportação passam por aqui: o mesmo recorte.
 */
export async function coDonosDoFiltro(
  organizationId: string,
  filters: { donosMultiplos?: boolean; filterResponsible?: string },
): Promise<string[] | undefined> {
  const membro = filters.filterResponsible;
  if (!filters.donosMultiplos || !membro || !UUID_DONO.test(membro)) return undefined;
  return buscarLeadIdsCoDono(organizationId, membro);
}

/** Chave do cache dos donos de um lead — PR3 invalida ao escrever. */
export const leadOwnersKey = (leadId: string | null) => ["lead-owners", leadId] as const;

/**
 * Donos de UM lead, na ordem de exibição. Para quem recebe o lead sem o embed
 * (o painel do chat lê de `useLeadByPhone`/`useLeadById`, que têm shape fixo).
 * Desligado fora da flag: zero leitura.
 */
export function useLeadOwners(leadId: string | null | undefined, enabled: boolean) {
  return useQuery<LeadOwner[]>({
    queryKey: leadOwnersKey(leadId ?? null),
    enabled: enabled && !!leadId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select(LEAD_OWNERS_EMBED)
        .eq("id", leadId as string)
        .maybeSingle();
      if (error) throw error;
      const linha = data as { lead_owners?: LeadOwnerRow[] | null } | null;
      return resolveLeadOwners({ lead_owners: linha?.lead_owners ?? [] });
    },
  });
}
