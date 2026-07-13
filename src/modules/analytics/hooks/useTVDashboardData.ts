// Invariante: receita do mês = Σ sale_value (SEM × contract_duration).
// Regra vale para toda superfície do projeto — RPC, hooks, componentes.
// Ref: Obsidian/…/04 — Decisões/2026-04-24-receita-mes-canonica-projeto.md
//
// Issue #999 (SP-3, PRD #986, ADR-0017): a TV lê o CADERNO canônico. Receita,
// venda e ticket vêm de get_sales_metrics (#995, líquido de estorno, âncora
// única sold_at, corte de período no tz da org). Reunião vem de meeting_events
// (ADR-0007) via useSDRPerformance — a MESMA fonte do KPI "Reuniões", matando o
// R6 (Reuniões ≠ Comparecidas na mesma tela). Fim do recompute client-side de
// ticket/conversão e da dependência do array truncado em 500 (usePipelineEntries).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeamMembers, useCurrentTeamMember, useIdentity } from "@/modules/identity";
import { usePipePropostas, usePipeConfirmacao, usePipeWhatsapp } from "@/modules/pipelines";
import { useTeamGoals, useIndividualGoals } from "@/modules/engagement/hooks/useGoals";
import { useSDRPerformance } from "@/modules/engagement/hooks/useSDRPerformance";
import { isRpcAbsentError } from "@/lib/rpc-errors";
import {
  localDateStr,
  unwrapRpcJsonb,
  streamTicket,
  type SalesMetricsResult,
} from "@/modules/analytics/types/canonical-tv";

export interface TVDashboardMetrics {
  // Sales goals
  metaVendasMes: number;
  vendasRealizadas: number;
  vendasMRR: number;
  vendasProjeto: number;
  ondeDeveriamEstar: number;
  quantoFalta: number;

  // Meetings
  reunioesComparecidas: number;

  // Conversion
  taxaConversaoGeral: number;
  conversaoPorCloser: { name: string; rate: number; sales: number; proposals: number }[];

  // Tickets
  ticketMedioMRR: number;
  ticketMedioProjeto: number;
  // Canonical net-of-reversal ticket (get_sales_metrics.ticket_medio). New dim (#999).
  ticketMedio: number;

  // No-show
  noShowGeral: number;
  noShowPorCloser: { name: string; rate: number }[];

  // Leads to work
  leadsParaTrabalhar: number;
  leadsRemarcar: number;
  leadsNovo: number;
  leadsAbordado: number;

  // Hot proposals
  propostasQuentes: any[];

  // Monthly sales
  vendasDoMes: any[];

  // Individual goals
  individualGoals: {
    closers: { name: string; id: string; current: number; goal: number; percentage: number }[];
    sdrs: { name: string; id: string; current: number; goal: number; percentage: number }[];
  };

  // Funnel data
  funnel: {
    reunioesMarcadas: number;
    comparecidas: number;
    marcandoR2: number;
    marcandoR2Value: number;
    r2Marcadas: number;
    r2MarcadasValue: number;
    vendido: number;
    vendidoValue: number;
  };
}

export function useTVDashboardData() {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const dayOfMonth = now.getDate();
  const lastDayOfMonth = new Date(currentYear, currentMonth, 0).getDate();

  const { isAdmin } = useIdentity();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const { data: teamMembers } = useTeamMembers();
  const { data: propostas } = usePipePropostas();
  const { data: confirmacoes } = usePipeConfirmacao();
  const { data: whatsapp } = usePipeWhatsapp();
  const { data: teamGoals } = useTeamGoals(currentMonth, currentYear);
  const { data: individualGoals } = useIndividualGoals(currentMonth, currentYear);

  // Reunião: MESMA fonte do KPI "Reuniões" (useSDRPerformance → meeting_events,
  // ADR-0007). Range = mês civil (dia 1 → agora). Reconcilia funnel.comparecidas
  // com o KPI por construção — mata o R6. Não inventamos um motor de reunião novo.
  const monthStart = new Date(currentYear, currentMonth - 1, 1, 0, 0, 0, 0);
  const sdrPerf = useSDRPerformance({ start: monthStart, end: now });

  const myId = currentTeamMember?.id ?? null;

  return useQuery({
    queryKey: [
      "tv-dashboard-canonical",
      currentMonth, currentYear, isAdmin, myId, organizationId,
      propostas, confirmacoes, whatsapp, teamGoals, individualGoals,
      sdrPerf.totals.marcadas, sdrPerf.totals.comparecidas, sdrPerf.totals.noShowRate,
    ],
    queryFn: async (): Promise<TVDashboardMetrics> => {
      // ── Fonte canônica de VENDA: get_sales_metrics (#995) ────────────────
      // Período NOMEADO ('month' + ref hoje); o banco resolve as fronteiras no
      // tz da org. O frontend NUNCA converte tz nem trunca entries. Receita já
      // líquida de estorno, agregada no servidor sobre o conjunto completo.
      let sales: SalesMetricsResult | null = null;
      // Canonical is always-on. Only degrade to zeros when the RPC is genuinely
      // ABSENT (migration not applied) — never behind a dark-launch flag. The U3
      // gate was removed: it shipped OFF for 100% of orgs and silently zeroed all
      // TV money (incident 2026-07-13). A real deployed-RPC runtime error still
      // propagates (FIX-A) instead of masking money as zero.
      if (organizationId) {
        const { data, error } = await supabase.rpc("get_sales_metrics" as any, {
          p_org_id: organizationId,
          p_period: "month",
          p_ref: localDateStr(now),
          p_pipeline_id: null,
          // Central de controle: admin vê o time; não-admin vê só os próprios números.
          p_filter_member_id: isAdmin ? null : myId,
        });
        if (error) {
          // RPC ausente (migration não aplicada) → degrada pra zeros em vez de
          // travar a TV. get_dashboard_metrics segue vivo como rollback (ADR-0018).
          // Detecção por CÓDIGO apenas (FIX-A): um erro de runtime real da RPC
          // canônica implantada propaga (throw) em vez de zerar dinheiro em silêncio.
          if (!isRpcAbsentError(error)) {
            throw new Error(`get_sales_metrics failed: ${error.message}`);
          }
        } else {
          sales = unwrapRpcJsonb<SalesMetricsResult>(data);
        }
      }

      const revenueTotal = sales?.revenue_total ?? 0;
      const wonCount = sales?.won_count ?? 0;
      const lostCount = sales?.lost_count ?? 0;
      const byCloser = sales?.by_closer ?? [];
      const streamNovo = sales?.revenue_by_stream?.novo_negocio;
      const streamCarteira = sales?.revenue_by_stream?.carteira;

      // Filtros por usuário (não-admin) para as listas/estados ainda lidos do pipe.
      const propostasFiltradas = isAdmin ? (propostas ?? []) : (propostas ?? []).filter(p => (p as any).sale_responsible_id === myId || (p as any).responsible_id === myId || p.closer_id === myId);
      const confirmacoesFiltradas = isAdmin ? (confirmacoes ?? []) : (confirmacoes ?? []).filter(c => (c as any).pre_sale_responsible_id === myId || (c as any).responsible_id === myId || c.sdr_id === myId);
      const whatsappFiltrado = isAdmin ? (whatsapp ?? []) : (whatsapp ?? []).filter(w => (w as any).pre_sale_responsible_id === myId || (w as any).responsible_id === myId || w.sdr_id === myId);

      const closers = isAdmin
        ? (teamMembers?.filter(m => (m as any).metric_type === "sales" && m.is_active) || [])
        : (currentTeamMember && (currentTeamMember as any).metric_type === "sales" ? [currentTeamMember] : []);

      // Meta (goals, NÃO ledger — alvos): admin vê meta do time; não-admin, a individual.
      const salesGoalFaturamento = teamGoals?.find(g => g.type === "faturamento" || g.name.toLowerCase().includes("faturamento"));
      const salesGoalVendas = teamGoals?.find(g => g.type === "vendas" && !g.team_member_id);
      const salesGoal = salesGoalFaturamento || salesGoalVendas;
      const somaMetasSales = individualGoals?.salesGoals?.reduce((s, g) => s + (g.goal || 0), 0) ?? 0;
      const myGoal = myId && individualGoals?.salesGoals
        ? individualGoals.salesGoals.find(g => g.id === myId)
        : myId && individualGoals?.meetingsGoals
          ? individualGoals.meetingsGoals.find(g => g.id === myId)
          : null;
      const metaVendasMes = isAdmin
        ? (salesGoal?.target_value || somaMetasSales || 0)
        : (myGoal?.goal ?? 0);

      // Receita do mês = canônica (get_sales_metrics.revenue_total).
      const vendasRealizadas = revenueTotal;
      // TODO(design #999): o caderno modela revenue_stream (novo_negocio|carteira),
      // NÃO product_type (mrr|projeto). Campos mantidos por compat de shape,
      // alimentados pelo stream canônico. Rótulos product_type saem quando o
      // ledger carregar product_type.
      const vendasMRR = streamNovo?.revenue ?? 0;
      const vendasProjeto = streamCarteira?.revenue ?? 0;

      const progressoEsperado = dayOfMonth / lastDayOfMonth;
      const ondeDeveriamEstar = metaVendasMes * progressoEsperado;
      const quantoFalta = Math.max(0, metaVendasMes - vendasRealizadas);

      // ── Reunião: fonte única meeting_events (via useSDRPerformance) ───────
      const reunioesComparecidas = sdrPerf.totals.comparecidas;

      // Ticket: canônico. Overall = get_sales_metrics.ticket_medio (líquido).
      const ticketMedio = sales?.ticket_medio ?? 0;
      // TODO(design #999): split por stream (não product_type) — ver acima.
      const ticketMedioMRR = streamTicket(streamNovo);
      const ticketMedioProjeto = streamTicket(streamCarteira);

      // Conversão geral = won / (won + lost), do caderno canônico (#995).
      // Substitui o recompute client-side vendido/totalNoPipe sobre array truncado.
      const denomConv = wonCount + lostCount;
      const taxaConversaoGeral = denomConv > 0 ? (wonCount / denomConv) * 100 : 0;

      // Conversão por closer: o caderno dá receita/contagem por membro (won), mas
      // NÃO o denominador de propostas — logo `rate` não é derivável do ledger.
      // TODO(design #999): expor propostas por membro numa RPC de funil por closer.
      const conversaoPorCloser = closers.map(closer => {
        const row = byCloser.find(b => b.member_id === closer.id);
        return { name: closer.name, rate: 0, sales: row?.sale_count ?? 0, proposals: 0 };
      });

      // No-show: fonte única meeting_events (mesma do KPI). Per-closer fica p/ SP-4.
      const noShowGeral = sdrPerf.totals.noShowRate;
      const noShowPorCloser: { name: string; rate: number }[] = [];

      // Leads p/ trabalhar: estado do kanban (não é métrica de venda/reunião — fora
      // do escopo #999). Contagens de estado atual, não período.
      const leadsRemarcar = confirmacoesFiltradas.filter(c => c.status === "remarcar").length;
      const leadsNovo = whatsappFiltrado.filter(w => w.status === "novo").length;
      const leadsAbordado = whatsappFiltrado.filter(w => w.status === "abordado").length;
      const leadsParaTrabalhar = leadsRemarcar + leadsNovo + leadsAbordado;

      // Propostas quentes: LISTA (não agregado) p/ o Coach IA — segue do pipe.
      const propostasQuentes = propostasFiltradas.filter(p =>
        (p.calor || 0) >= 7 && !["vendido", "perdido"].includes(p.status)
      ).slice(0, 10);

      // vendasDoMes: lista de vendas do período NÃO é exposta pelo caderno leitor;
      // consumidores da TV não a usam. Vazia (sem depender do array truncado).
      const vendasDoMes: any[] = [];

      // Metas individuais: current agora vem do caderno (venda por membro = by_closer;
      // reunião por SDR = meeting_events), não do array truncado.
      const salesGoalsSource = isAdmin ? (individualGoals?.salesGoals || []) : (myId && individualGoals?.salesGoals?.find(g => g.id === myId) ? [individualGoals.salesGoals.find(g => g.id === myId)!] : []);
      const meetingsGoalsSource = isAdmin ? (individualGoals?.meetingsGoals || []) : (myId && individualGoals?.meetingsGoals?.find(g => g.id === myId) ? [individualGoals.meetingsGoals.find(g => g.id === myId)!] : []);

      const salesGoalsCalc = salesGoalsSource.map(g => {
        const currentValue = byCloser.find(b => b.member_id === g.id)?.revenue ?? 0;
        const goalValue = g.goal || 0;
        const percentage = goalValue > 0 ? Math.round((currentValue / goalValue) * 100) : 0;
        return { name: g.name, id: g.id, current: currentValue, goal: goalValue, percentage };
      });
      const meetingsGoalsCalc = meetingsGoalsSource.map(g => {
        const currentValue = sdrPerf.bySDR.find(s => s.id === g.id)?.comparecidas ?? 0;
        const goalValue = g.goal || 0;
        const percentage = goalValue > 0 ? Math.round((currentValue / goalValue) * 100) : 0;
        return { name: g.name, id: g.id, current: currentValue, goal: goalValue, percentage };
      });

      // ── Funil ────────────────────────────────────────────────────────────
      // Reuniões marcadas + comparecidas: meeting_events (MESMA fonte do KPI → R6).
      const reunioesMarcadasFunnel = sdrPerf.totals.marcadas;
      const comparecidasFunnel = sdrPerf.totals.comparecidas;

      // Etapas R2 (marcar_compromisso/reativar, compromisso_marcado): sub-estágios
      // org-específicos do funil de propostas, SEM role canônico em get_funnel_flow
      // (que só modela open→booked→held→won). Seguem do pipe até governança de role
      // cobrir R2. TODO(design #999): mapear R2 a stage_role e ler do caderno.
      const marcandoR2Propostas = propostasFiltradas.filter(p =>
        p.status === "marcar_compromisso" || p.status === "reativar"
      );
      const marcandoR2 = marcandoR2Propostas.length;
      const marcandoR2Value = marcandoR2Propostas.reduce((sum, p) => sum + (p.sale_value || 0), 0);

      const r2MarcadasPropostas = propostasFiltradas.filter(p => p.status === "compromisso_marcado");
      const r2Marcadas = r2MarcadasPropostas.length;
      const r2MarcadasValue = r2MarcadasPropostas.reduce((sum, p) => sum + (p.sale_value || 0), 0);

      // Vendido: contagem e valor canônicos (get_sales_metrics), sem truncamento.
      const vendidoFunnel = wonCount;
      const vendidoValue = revenueTotal;

      return {
        metaVendasMes,
        vendasRealizadas,
        vendasMRR,
        vendasProjeto,
        ondeDeveriamEstar,
        quantoFalta,
        reunioesComparecidas,
        taxaConversaoGeral,
        conversaoPorCloser,
        ticketMedioMRR,
        ticketMedioProjeto,
        ticketMedio,
        noShowGeral,
        noShowPorCloser,
        leadsParaTrabalhar,
        leadsRemarcar,
        leadsNovo,
        leadsAbordado,
        propostasQuentes,
        vendasDoMes,
        individualGoals: {
          closers: salesGoalsCalc,
          sdrs: meetingsGoalsCalc,
        },
        funnel: {
          reunioesMarcadas: reunioesMarcadasFunnel,
          comparecidas: comparecidasFunnel,
          marcandoR2,
          marcandoR2Value,
          r2Marcadas,
          r2MarcadasValue,
          vendido: vendidoFunnel,
          vendidoValue,
        },
      };
    },
    // Não gate em !!sales: se a RPC falhar (RLS/schema/ledger vazio), renderiza TV
    // com zeros na receita em vez de travar em loading indefinido.
    enabled: !!teamMembers && !!propostas && !!confirmacoes && !!whatsapp && (isAdmin !== undefined),
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
    refetchIntervalInBackground: false,
  });
}
