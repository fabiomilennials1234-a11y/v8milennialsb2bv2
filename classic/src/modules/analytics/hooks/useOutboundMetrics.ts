/**
 * useOutboundMetrics — Queries dashboard metrics for outbound members
 *
 * Returns current month + previous month values for comparison arrows.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
export interface OutboundMetrics {
  leadsRecebidos: number;
  leadsRecebidosPrev: number;
  taxaResposta: number;       // 0-100 percentage
  taxaRespostaPrev: number;
  reunioesAgendadas: number;
  reunioesAgendadasPrev: number;
  vendasFechadas: number;
  vendasFechadasPrev: number;
}

function getMonthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1).toISOString();
  const end = new Date(year, month, 0, 23, 59, 59).toISOString();
  return { start, end };
}

export function useOutboundMetrics() {
  const { organizationId, isReady } = useOrganization();

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  return useQuery({
    queryKey: ["outbound-metrics", organizationId, year, month],
    queryFn: async (): Promise<OutboundMetrics> => {
      if (!organizationId) throw new Error("No org");

      const curr = getMonthRange(year, month);
      const prev = getMonthRange(prevYear, prevMonth);

      // 1. Leads recebidos (leads created this month in this org)
      const [leadsNow, leadsPrev] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", curr.start).lte("created_at", curr.end)
          .or("is_shadow.is.null,is_shadow.eq.false"),
        supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", prev.start).lte("created_at", prev.end)
          .or("is_shadow.is.null,is_shadow.eq.false"),
      ]);

      // 2. Taxa de resposta: leads with at least 1 conversation reply
      const [respondedNow, respondedPrev] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", curr.start).lte("created_at", curr.end)
          .not("last_message_at", "is", null),
        supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", prev.start).lte("created_at", prev.end)
          .not("last_message_at", "is", null),
      ]);

      const leadsRecebidos = leadsNow.count ?? 0;
      const leadsRecebidosPrev = leadsPrev.count ?? 0;
      const respondidos = respondedNow.count ?? 0;
      const respondidosPrev = respondedPrev.count ?? 0;

      const taxaResposta = leadsRecebidos > 0 ? Math.round((respondidos / leadsRecebidos) * 100) : 0;
      const taxaRespostaPrev = leadsRecebidosPrev > 0 ? Math.round((respondidosPrev / leadsRecebidosPrev) * 100) : 0;

      // 3. Reuniões agendadas (entradas do funil de confirmação neste mês)
      const [reunioesNow, reunioesPrev] = await Promise.all([
        supabase.from("negocio_projetado").select("id", { count: "exact", head: true })
          .eq("funil_sistema", "confirmacao")
          .eq("organization_id", organizationId)
          .gte("created_at", curr.start).lte("created_at", curr.end),
        supabase.from("negocio_projetado").select("id", { count: "exact", head: true })
          .eq("funil_sistema", "confirmacao")
          .eq("organization_id", organizationId)
          .gte("created_at", prev.start).lte("created_at", prev.end),
      ]);

      // 4. Vendas fechadas — COALESCE(metrics_period_at, closed_at)
      const [vNowM, vNowC, vPrevM, vPrevC] = await Promise.all([
        supabase.from("negocio_projetado").select("id", { count: "exact", head: true })
          .eq("funil_sistema", "propostas")
          .eq("organization_id", organizationId)
          .eq("stage_key", "vendido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", curr.start).lte("metrics_period_at", curr.end),
        supabase.from("negocio_projetado").select("id", { count: "exact", head: true })
          .eq("funil_sistema", "propostas")
          .eq("organization_id", organizationId)
          .eq("stage_key", "vendido")
          .is("metrics_period_at", null)
          .gte("closed_at", curr.start).lte("closed_at", curr.end),
        supabase.from("negocio_projetado").select("id", { count: "exact", head: true })
          .eq("funil_sistema", "propostas")
          .eq("organization_id", organizationId)
          .eq("stage_key", "vendido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", prev.start).lte("metrics_period_at", prev.end),
        supabase.from("negocio_projetado").select("id", { count: "exact", head: true })
          .eq("funil_sistema", "propostas")
          .eq("organization_id", organizationId)
          .eq("stage_key", "vendido")
          .is("metrics_period_at", null)
          .gte("closed_at", prev.start).lte("closed_at", prev.end),
      ]);

      return {
        leadsRecebidos,
        leadsRecebidosPrev,
        taxaResposta,
        taxaRespostaPrev,
        reunioesAgendadas: reunioesNow.count ?? 0,
        reunioesAgendadasPrev: reunioesPrev.count ?? 0,
        vendasFechadas: (vNowM.count ?? 0) + (vNowC.count ?? 0),
        vendasFechadasPrev: (vPrevM.count ?? 0) + (vPrevC.count ?? 0),
      };
    },
    enabled: isReady,
    staleTime: 2 * 60 * 1000,
  });
}
