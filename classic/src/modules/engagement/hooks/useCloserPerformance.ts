/**
 * useCloserPerformance(range)
 *
 * Por closer no range:
 * - reunioesRealizadas: negocio_projetado[confirmacao] stage_key=compareceu, meeting_date no range, atrib. closer
 * - propostas: negocio_projetado[propostas] com metrics_period_at ?? created_at no range
 * - vendas: negocio_projetado[propostas] stage_key=vendido, closed_at no range (ADR 2026-04-24)
 * - vendasValor: Σ sale_value (sem × contract_duration)
 * - ticketMedio: vendasValor / vendas
 * - conversao: vendas / propostas * 100
 *
 * Atribuição closer: sale_responsible_id ?? closer_id (snapshot dual ADR 2026-05-18).
 * Atribuição SDR (pra reunião): closer real = sale_responsible_id ?? closer_id da confirmacao.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useOrganization, useTeamMembers } from "@/modules/identity";
import { useAvatarMap } from "@/modules/identity/hooks/useAvatarMap";
import { inRange, type TVPeriodRange } from "@/lib/tv-periods";

// Leitura direta da projeção canônica `negocio_projetado` (data layer), recortada
// por `funil_sistema`, scoped por organization_id, em vez de importar os hooks de valor do módulo
// pipelines. Quebra a aresta engagement→pipelines que fechava o
// ciclo leads→engagement→pipelines→leads. Tipos vêm de core (Tables<...>).
// Sem realtime (regra: nunca subscription em views pipe_*). A atualização ao vivo
// vem de refetchInterval (polling): staleTime sozinho deixava o board congelado
// após uma venda até o remount, pois não há realtime/invalidation e
// refetchOnWindowFocus é global false (kiosk TV nunca dispara focus).
//
// ESCOPO = ORG-WIDE (decisão CTO 2026-06-02, finding ENG-USAB-1). A projeção é
// filtrada apenas por organization_id (+ funil_sistema) — performance é métrica de equipe/gestão
// (TV kiosk + página Performance), então todos os membros veem os números da org
// inteira. Diferente da fonte antiga (usePipelineEntries) que filtrava por leads
// visíveis ao caller como efeito colateral do embed `lead:leads(...)`. Não
// reintroduzir filtro por lead-visibility aqui: org-wide é intencional. A projeção
// expõe só ids/sale_value/stage_key (sem PII de lead).

type PipePropostaRow = Tables<"negocio_projetado">;
type PipeConfirmacaoRow = Tables<"negocio_projetado">;

const PERF_STALE_TIME = 60 * 1000;
// Polling p/ manter os dashboards de performance vivos (TV kiosk + páginas de perf)
// sem reintroduzir subscription nas views. Casa com o setInterval de 30s do TVDashboard.
// React Query pausa o polling com a aba oculta (refetchIntervalInBackground=false default),
// então consumidores fora de foco não geram custo.
const PERF_REFETCH_INTERVAL = 30 * 1000;

export function usePerfPipePropostas() {
  const { organizationId, isReady } = useOrganization();
  return useQuery({
    queryKey: ["pipe_propostas", "perf", organizationId],
    queryFn: async () => {
      if (!organizationId) return [] as PipePropostaRow[];
      const { data, error } = await supabase
        .from("negocio_projetado")
        .select(
          "stage_key, metrics_period_at, created_at, closed_at, sale_value, sale_responsible_id, closer_id"
        )
        .eq("funil_sistema", "propostas")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as PipePropostaRow[];
    },
    enabled: isReady && !!organizationId,
    staleTime: PERF_STALE_TIME,
    refetchInterval: PERF_REFETCH_INTERVAL,
  });
}

export function usePerfPipeConfirmacao() {
  const { organizationId, isReady } = useOrganization();
  return useQuery({
    queryKey: ["pipe_confirmacao", "perf", organizationId],
    queryFn: async () => {
      if (!organizationId) return [] as PipeConfirmacaoRow[];
      const { data, error } = await supabase
        .from("negocio_projetado")
        .select(
          "stage_key, meeting_date, metrics_period_at, created_at, sale_responsible_id, closer_id, pre_sale_responsible_id, sdr_id"
        )
        .eq("funil_sistema", "confirmacao")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as PipeConfirmacaoRow[];
    },
    enabled: isReady && !!organizationId,
    staleTime: PERF_STALE_TIME,
    refetchInterval: PERF_REFETCH_INTERVAL,
  });
}

export interface CloserPerformanceRow {
  id: string;
  name: string;
  avatarUrl?: string;
  reunioesRealizadas: number;
  propostas: number;
  vendas: number;
  vendasValor: number;
  ticketMedio: number;
  conversao: number;
}

export interface CloserPerformanceData {
  totals: {
    reunioesRealizadas: number;
    propostas: number;
    vendas: number;
    vendasValor: number;
    ticketMedio: number;
    conversao: number;
  };
  byCloser: CloserPerformanceRow[];
  topCloserId: string | null;
}

const closerOf = (row: any): string | null =>
  row.sale_responsible_id ?? row.closer_id ?? null;

export function useCloserPerformance(range: TVPeriodRange): CloserPerformanceData {
  const { data: propostas = [] } = usePerfPipePropostas();
  const { data: confirmacoes = [] } = usePerfPipeConfirmacao();
  const { data: teamMembers = [] } = useTeamMembers();
  const avatarMap = useAvatarMap();

  return useMemo(() => {
    const closers = (teamMembers ?? []).filter(
      (m: any) => m.metric_type === "sales" && m.is_active
    );

    const propostasNoRange = (propostas as any[]).filter((p) => {
      const at = p.metrics_period_at ?? p.created_at;
      return inRange(at, range);
    });

    const vendasNoRange = (propostas as any[]).filter((p) => {
      if (p.stage_key !== "vendido") return false;
      const at = p.closed_at ?? p.metrics_period_at;
      return inRange(at, range);
    });

    const reunioesRealizadasNoRange = (confirmacoes as any[]).filter(
      (c) => c.stage_key === "compareceu" && inRange(c.meeting_date, range)
    );

    const byCloser: CloserPerformanceRow[] = closers.map((closer: any) => {
      const cReuns = reunioesRealizadasNoRange.filter((c) => closerOf(c) === closer.id).length;
      const cProps = propostasNoRange.filter((p) => closerOf(p) === closer.id).length;
      const cVendasArr = vendasNoRange.filter((p) => closerOf(p) === closer.id);
      const cVendas = cVendasArr.length;
      const cValor = cVendasArr.reduce((s, p) => s + (p.sale_value || 0), 0);
      const ticket = cVendas > 0 ? cValor / cVendas : 0;
      const conv = cProps > 0 ? (cVendas / cProps) * 100 : 0;

      return {
        id: closer.id,
        name: closer.name,
        avatarUrl: avatarMap.get(closer.id),
        reunioesRealizadas: cReuns,
        propostas: cProps,
        vendas: cVendas,
        vendasValor: cValor,
        ticketMedio: ticket,
        conversao: conv,
      };
    });

    byCloser.sort((a, b) => b.vendasValor - a.vendasValor);

    const totalReuns = reunioesRealizadasNoRange.length;
    const totalProps = propostasNoRange.length;
    const totalVendas = vendasNoRange.length;
    const totalValor = vendasNoRange.reduce((s, p) => s + (p.sale_value || 0), 0);
    const ticketTotal = totalVendas > 0 ? totalValor / totalVendas : 0;
    const convTotal = totalProps > 0 ? (totalVendas / totalProps) * 100 : 0;

    return {
      totals: {
        reunioesRealizadas: totalReuns,
        propostas: totalProps,
        vendas: totalVendas,
        vendasValor: totalValor,
        ticketMedio: ticketTotal,
        conversao: convTotal,
      },
      byCloser,
      topCloserId: byCloser[0]?.id ?? null,
    };
  }, [propostas, confirmacoes, teamMembers, avatarMap, range.start.getTime(), range.end.getTime()]);
}
