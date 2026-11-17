import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAgendaEvents } from "@/modules/engagement";
import { useAgendaContatos } from "@/modules/analytics/hooks/useAgendaContatos";
import { useComandoScope } from "@/modules/analytics/hooks/useComandoScope";
import { useEscopoAgenda } from "@/modules/analytics/hooks/useEscopoAgenda";
import { eventoDaAgendaVisivel } from "@/modules/analytics/lib/comando-escopo";
import { hojeNoFuso } from "@/modules/analytics/lib/agenda-contatos";
import {
  janelaDeBusca,
  montarAgenda,
  type EventoDaAgenda,
  type ItemAgenda,
  type Periodo,
} from "@/modules/analytics/lib/agenda-unificada";

/** Dados do cliente que a planilha mostra e o evento da Agenda não traz. */
export interface ClienteDaAgenda {
  erpCode: string | null;
  phone: string | null;
  uf: string | null;
  cidade: string | null;
  representante: string | null;
}

const LOTE = 100;

/**
 * Cód., telefone, cidade e representante dos clientes das reuniões e mensagens
 * — as mesmas colunas que o próximo contato já mostra. Em lotes: 100 ids por
 * requisição cabem na URL do PostgREST.
 */
function useClientesDaAgenda(leadIds: string[]) {
  const { organizationId } = useOrganization();
  const chave = useMemo(() => [...leadIds].sort().join(","), [leadIds]);
  return useQuery({
    queryKey: ["comando", "agenda-unificada", "clientes", organizationId, chave],
    enabled: !!organizationId && leadIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, ClienteDaAgenda>> => {
      const mapa = new Map<string, ClienteDaAgenda>();
      for (let i = 0; i < leadIds.length; i += LOTE) {
        const ids = leadIds.slice(i, i + LOTE);
        const [leads, upsell] = await Promise.all([
          supabase.from("leads").select("id, phone, erp_code, uf").eq("organization_id", organizationId as string).in("id", ids),
          supabase
            .from("upsell_clients")
            .select("lead_id, erp_city, erp_uf, erp_owner_name")
            .eq("organization_id", organizationId as string)
            .in("lead_id", ids),
        ]);
        if (leads.error) throw leads.error;
        if (upsell.error) throw upsell.error;
        const porLead = new Map((upsell.data ?? []).map((u) => [u.lead_id as string, u]));
        for (const l of leads.data ?? []) {
          const u = porLead.get(l.id as string);
          mapa.set(l.id as string, {
            erpCode: (l.erp_code as string | null) ?? null,
            phone: (l.phone as string | null) ?? null,
            uf: (u?.erp_uf as string | null)?.trim() || ((l.uf as string | null) ?? null),
            cidade: (u?.erp_city as string | null)?.trim() || null,
            representante: (u?.erp_owner_name as string | null)?.trim() || null,
          });
        }
      }
      return mapa;
    },
  });
}

/**
 * A Agenda do Comando como máscara: reuniões + mensagens agendadas + próximos
 * contatos, do período escolhido, no escopo Meu/Todos da própria Agenda.
 */
export function useAgendaUnificada(periodo: Periodo) {
  const { timezone } = useOrganization();
  const escopo = useEscopoAgenda();
  const { meuTeamMemberId, meuUserId } = useComandoScope();
  const diaCorrente = new Date().toDateString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a data é a dependência real
  const hoje = useMemo(() => hojeNoFuso(timezone), [timezone, diaCorrente]);
  const { inicio, fim } = useMemo(() => janelaDeBusca(hoje, periodo), [hoje, periodo]);

  const eventos = useAgendaEvents(inicio, fim);
  const contatos = useAgendaContatos();

  const itens: ItemAgenda[] = useMemo(() => {
    const visiveis = ((eventos.data ?? []) as EventoDaAgenda[]).filter((e) =>
      eventoDaAgendaVisivel(e, meuTeamMemberId, meuUserId, escopo.somenteMeus ? "meu" : "tudo"),
    );
    return montarAgenda({ eventos: visiveis, contatos: contatos.data ?? [], hoje, periodo, timezone });
  }, [eventos.data, contatos.data, hoje, periodo, timezone, escopo.somenteMeus, meuTeamMemberId, meuUserId]);

  const leadIds = useMemo(
    () => [...new Set(itens.filter((i) => i.tipo !== "contato" && i.leadId).map((i) => i.leadId as string))],
    [itens],
  );
  const clientes = useClientesDaAgenda(leadIds);

  return {
    hoje,
    itens,
    clientes: clientes.data ?? new Map<string, ClienteDaAgenda>(),
    isLoading: eventos.isLoading || contatos.isLoading,
    isError: eventos.isError || contatos.isError,
    refetch: () => {
      void eventos.refetch();
      void contatos.refetch();
    },
  };
}
