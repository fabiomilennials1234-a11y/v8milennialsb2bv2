import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization, useTeamMembers } from "@/modules/identity";
import { dealBoardPath, useLeadsDeals } from "@/modules/leads";
import { ordenarNegociosDoChat, valorDoResumo, type NegocioDoChat } from "../../lib/negocioNoChat";

export type { NegocioDoChat } from "../../lib/negocioNoChat";

type Linha = Record<string, unknown>;

const num = (v: unknown): number | null =>
  typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * Os negócios do lead da conversa, já resumidos para o painel do chat.
 *
 * `useLeadsDeals` dá posição, título, funil, etapa e desfecho — a mesma leitura
 * do Card do Negócio. Ele NÃO traz o que o resumo mais precisa: responsável
 * (`pipeline_entries.assigned_to`), valor de `deals`/`deal_items` e a data de
 * criação do negócio. Isso vem numa consulta só, por lead, e só roda quando o
 * painel está liberado para a org (`enabled`) — nenhuma query a mais no
 * caminho quente das outras orgs.
 */
export function useNegociosDoLeadNoChat(leadId: string | null, enabled: boolean) {
  const { organizationId } = useOrganization();
  const ativo = enabled && !!leadId && !!organizationId;

  const ids = useMemo(() => (ativo && leadId ? [leadId] : []), [ativo, leadId]);
  const { data: dealsMap, isLoading: carregandoNegocios } = useLeadsDeals(ids);
  const { data: equipe = [] } = useTeamMembers();

  const detalhes = useQuery({
    queryKey: ["chat-negocios-do-lead", organizationId, leadId],
    enabled: ativo,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: entradas, error } = await supabase
        .from("pipeline_entries")
        .select("id, assigned_to, deal_id")
        .eq("organization_id", organizationId!)
        .eq("lead_id", leadId!);
      if (error) throw error;

      const dealIds = Array.from(
        new Set(
          (entradas ?? [])
            .map((e) => (e as Linha).deal_id)
            .filter((id): id is string => typeof id === "string" && id !== ""),
        ),
      );

      const [negociosRes, itensRes] = dealIds.length
        ? await Promise.all([
            supabase.from("deals").select("id, value, created_at").in("id", dealIds),
            supabase.from("deal_items").select("deal_id, total").in("deal_id", dealIds),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (negociosRes.error) throw negociosRes.error;
      if (itensRes.error) throw itensRes.error;

      return {
        entradas: (entradas ?? []) as Linha[],
        negocios: (negociosRes.data ?? []) as Linha[],
        itens: (itensRes.data ?? []) as Linha[],
      };
    },
  });

  const negocios = useMemo<NegocioDoChat[]>(() => {
    if (!ativo || !leadId) return [];
    const base = dealsMap?.[leadId] ?? [];

    const entradaPorId = new Map((detalhes.data?.entradas ?? []).map((e) => [String(e.id), e]));
    const negocioPorId = new Map((detalhes.data?.negocios ?? []).map((n) => [String(n.id), n]));
    const itensPorNegocio = new Map<string, number>();
    for (const i of detalhes.data?.itens ?? []) {
      const id = String(i.deal_id);
      itensPorNegocio.set(id, (itensPorNegocio.get(id) ?? 0) + (num(i.total) ?? 0));
    }

    /**
     * `assigned_to` guarda ora o id do membro, ora o `user_id` — o Card do
     * Negócio aceita os dois (`useDealCardData`, `dono`). Membro de fora da org
     * visível fica sem nome em vez de estampar um uuid.
     */
    const nomeDoDono = (id: string | null): string | null => {
      if (!id) return null;
      for (const bruto of equipe as unknown[]) {
        const m = bruto as Linha | null;
        if (m && (m.id === id || m.user_id === id) && typeof m.name === "string" && m.name !== "") {
          return m.name;
        }
      }
      return null;
    };

    const lista = base.map((d): NegocioDoChat => {
      const entrada = d.historicalSale ? undefined : entradaPorId.get(d.id);
      const dealId = str(entrada?.deal_id);
      const negocio = dealId ? negocioPorId.get(dealId) : undefined;
      return {
        id: d.id,
        leadId: d.leadId,
        titulo: d.title,
        estado: d.outcome === "won" ? "ganho" : d.outcome === "lost" ? "perdido" : "aberto",
        funil: d.funnelName,
        funilCor: d.funnelColor,
        etapa: d.stageName,
        valor: d.historicalSale
          ? d.value > 0 ? d.value : null
          : valorDoResumo({
              totalDosItens: dealId && itensPorNegocio.has(dealId) ? itensPorNegocio.get(dealId)! : null,
              valorDoNegocio: num(negocio?.value),
              valorDoFunil: d.value,
            }),
        dono: nomeDoDono(str(entrada?.assigned_to)),
        // Mesma queda do card: sem linha em `deals`, a data é a de entrada no funil.
        criadoEm: str(negocio?.created_at) ?? d.enteredAt ?? null,
        diasNaEtapa: d.daysInStage,
        caminho: d.historicalSale ? null : dealBoardPath(d),
        vendaHistorica: d.historicalSale === true,
      };
    });

    return ordenarNegociosDoChat(lista);
  }, [ativo, leadId, dealsMap, detalhes.data, equipe]);

  return {
    negocios,
    isLoading: ativo && (carregandoNegocios || detalhes.isLoading),
  };
}
