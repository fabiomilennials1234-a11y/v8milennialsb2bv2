import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIdentity } from "@/modules/identity";
import { useCurrentTeamMember } from "@/modules/identity";
import { useFeatureFlag } from "@/modules/platform";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { isMissingSchemaError, isRpcAbsentError } from "@/lib/rpc-errors";
import { computeMeetingRates, type MeetingEventLike } from "@/modules/analytics/lib/meeting-rates";
import {
  monthPeriodArgs,
  rangePeriodArgs,
  type CanonicalPeriodArgs,
  type SalesMetricsResult,
  type RankingResult,
} from "@/modules/analytics/types/canonical-metrics";

/** Intervalo do mês em UTC — igual ao usado na importação (metrics_period_at = 1º do mês 00:00 UTC). */
function getMonthRangeUTC(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

interface DashboardMetrics {
  totalLeads: number;
  reunioesMarcadas: number;
  reunioesComparecidas: number;
  noShow: number;
  taxaNoShow: number;
  vendaTotal: number;
  vendaMRR: number;
  vendaProjeto: number;
  /**
   * A receita que MRR e Projeto não explicam — venda registrada sem item de
   * produto que a classifique.
   *
   * Existe como campo e não como conta feita na tela porque o número é grande e
   * ninguém deveria descobri-lo subtraindo: medido em 6 meses, 280 de 428
   * vendas não têm item, e são R$ 335 mil. Antes disso, quem olhasse as três
   * caixas via o dinheiro evaporar entre elas.
   *
   * Invariante: `vendaMRR + vendaProjeto + vendaSemClassificacao === vendaTotal`.
   */
  vendaSemClassificacao: number;
  ticketMedio: number;
  ticketMedioMRR: number;
  ticketMedioProjeto: number;
  novosClientes: number;
  // New fields for Central de Comandos B2B
  propostasEnviadas: number;
  tempoMedioResposta: number;
  vendaPrimeiroPedido: number;
  vendaBaseAtiva: number;
  taxaConversao: number;
  dailySales: Array<{ day: string; revenue: number; count: number }>;
  // ── Canonical ledger dimensions (#995 / ADR-0017). Additive & optional: legacy
  //    consumers ignore them; new surfaces can read them. Present only when the
  //    canonical get_sales_metrics overlay succeeded (see isCanonicalRevenue). ──
  /** true when vendaTotal/ticketMedio/stream came from the canonical ledger (net of reversals). */
  isCanonicalRevenue?: boolean;
  /** Reversal-aware revenue split by stream — novo_negocio (primeiro pedido) vs carteira (base ativa). */
  revenueByStream?: { novoNegocio: number; carteira: number };
  /** Revenue whose sale had no canonical sale_responsible_id (Σ closers + this == total). */
  unattributedRevenue?: number;
  /** Count of reversal-losing sales excluded from revenue in the period. */
  lostCount?: number;
}

const EMPTY_DASHBOARD_METRICS: DashboardMetrics = {
  totalLeads: 0, reunioesMarcadas: 0, reunioesComparecidas: 0,
  noShow: 0, taxaNoShow: 0, vendaTotal: 0, vendaMRR: 0,
  vendaProjeto: 0, vendaSemClassificacao: 0, ticketMedio: 0, ticketMedioMRR: 0,
  ticketMedioProjeto: 0, novosClientes: 0,
  propostasEnviadas: 0, tempoMedioResposta: 0,
  vendaPrimeiroPedido: 0, vendaBaseAtiva: 0, taxaConversao: 0, dailySales: [],
};

/**
 * Unwrap a jsonb RPC result that Supabase may hand back as a single-element array.
 */
function unwrapJsonb<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data.length > 0 ? data[0] : null) as T | null;
  return (data ?? null) as T | null;
}

/**
 * Overlay the CANONICAL sales ledger (get_sales_metrics, #995 / ADR-0017 §2-5) onto
 * a legacy DashboardMetrics base. The legacy RPC (get_dashboard_metrics) stays the
 * source for the non-money dimensions that this SP-3 slice has no ledger for — leads,
 * meetings, proposals, response time, conversion, dailySales — while MONEY is taken
 * from the append-only sale_events caderno: net of reversals (§3), single-key
 * attribution (R5), stream split decided by the client (§2). Period is NAMED and cut
 * in the org timezone by the DB (§5) — the frontend never computes UTC bounds.
 *
 * The canonical call degrades gracefully: if its migration is not yet applied
 * (PGRST202 / undefined_function), the legacy money survives untouched, so this is
 * a no-op in environments where the ledgers do not exist and becomes canonical the
 * moment they do (rollback = revert this commit; ADR-0018 keeps the legacy RPC alive).
 */
async function overlayCanonicalSales(
  base: DashboardMetrics,
  organizationId: string,
  month: number,
  year: number,
  filterMemberId: string | null,
): Promise<DashboardMetrics> {
  const period = monthPeriodArgs(month, year);
  const { data, error } = await supabase.rpc("get_sales_metrics" as never, {
    p_org_id: organizationId,
    p_period: period.p_period,
    p_ref: period.p_ref,
    p_start: period.p_start,
    p_end: period.p_end,
    p_pipeline_id: null,
    p_filter_member_id: filterMemberId,
  } as never);

  if (error) {
    // Migration pendente (RPC ausente) → mantém a receita legada. Detecção por
    // CÓDIGO apenas (FIX-A): um erro de runtime real da RPC canônica JÁ implantada
    // deve propagar, não degradar em silêncio pra dinheiro legado errado.
    if (isRpcAbsentError(error)) return base;
    console.error("❌ [overlayCanonicalSales] RPC error:", error.message, error.code);
    throw new Error(`get_sales_metrics failed: ${error.message}`);
  }

  const s = unwrapJsonb<SalesMetricsResult>(data);
  if (!s) return base;

  const novo = s.revenue_by_stream?.novo_negocio?.revenue ?? 0;
  const carteira = s.revenue_by_stream?.carteira?.revenue ?? 0;

  return {
    ...base,
    // Money → canonical (reversal-aware, single-key attribution).
    vendaTotal: s.revenue_total ?? base.vendaTotal,
    ticketMedio: s.ticket_medio ?? 0,
    novosClientes: s.won_count ?? base.novosClientes,
    // Stream split maps 1:1 onto the "Primeiro Pedido × Base Ativa" card (FirstOrderVsBase).
    vendaPrimeiroPedido: novo,
    vendaBaseAtiva: carteira,
    // Additive canonical dimensions.
    isCanonicalRevenue: true,
    revenueByStream: { novoNegocio: novo, carteira },
    unattributedRevenue: s.unattributed?.revenue ?? 0,
    lostCount: s.lost_count ?? 0,
  };
}

/** Enriched sales-ranking row consumed by TopPerformers / RankingTable / RankingPodium. */
/**
 * Superset estrutural das duas listas de ranking que este hook devolve.
 *
 * `salesRanking` traz `conversions`; `meetingsRanking` traz
 * `meetings`/`meetingsBooked`/`goalBooked`. Nenhum tem o campo do outro, então
 * um ternário entre eles vira união e ler campo exclusivo é erro de tipo — era
 * a causa de 4 dos erros que travavam o CI (Performance e RankingTable).
 *
 * Os campos divergentes entram opcionais: os dois shapes são atribuíveis a
 * este sem cast. `name` continua nullable porque vem do banco assim — quem
 * renderiza resolve o fallback, o tipo não mente pela conveniência da UI.
 */
export interface RankingSourceEntry {
  id: string;
  name: string | null;
  role: string;
  value: number;
  goal?: number;
  goalProgress: number;
  position: number;
  conversions?: number;
  meetings?: number;
  meetingsBooked?: number;
  goalBooked?: number;
  goalBookedProgress?: number;
}

interface SalesRankingEntry {
  id: string;
  name: string | null;
  job_title: string | null;
  metric_type: string;
  value: number;
  conversions: number;
  goal: number;
  goalProgress: number;
  position: number;
  role: string;
  /** Additive canonical dimension: share of period revenue ∈ [0,100]. */
  revenueShare?: number;
}

/**
 * Rebuild the sales podium from the CANONICAL leaderboard (get_ranking, #997 / ADR-0017),
 * enriching name/job_title/goal from the legacy row of the same member id. Money
 * (value), count (conversions) and position come from the caderno with single-key
 * attribution; goalProgress is recomputed against the canonical value so the bar
 * matches the canonical money. Members present in the legacy 5-key set but absent
 * from the canonical single-key set are correctly dropped (they earned no canonical
 * credit — R5). Degrades: RPC ausente → returns the legacy ranking unchanged.
 */
async function overlayCanonicalRanking(
  legacy: SalesRankingEntry[],
  organizationId: string,
  period: CanonicalPeriodArgs,
): Promise<SalesRankingEntry[]> {
  const { data, error } = await supabase.rpc("get_ranking" as never, {
    p_org_id: organizationId,
    p_period: period.p_period,
    p_ref: period.p_ref,
    p_start: period.p_start,
    p_end: period.p_end,
    p_pipeline_id: null,
  } as never);

  if (error) {
    // RPC ausente (migration pendente) → pódio legado intacto. Por CÓDIGO apenas
    // (FIX-A): erro de runtime real da RPC canônica implantada propaga, não some.
    if (isRpcAbsentError(error)) return legacy;
    console.error("❌ [overlayCanonicalRanking] RPC error:", error.message, error.code);
    throw new Error(`get_ranking failed: ${error.message}`);
  }

  const r = unwrapJsonb<RankingResult>(data);
  if (!r || !Array.isArray(r.ranking)) return legacy;

  const legacyById = new Map(legacy.map((m) => [m.id, m]));

  return r.ranking
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((entry): SalesRankingEntry => {
      const base = legacyById.get(entry.member_id);
      const goal = base?.goal ?? 0;
      return {
        id: entry.member_id,
        name: base?.name ?? null,
        job_title: base?.job_title ?? null,
        metric_type: base?.metric_type ?? "sales",
        value: entry.revenue,
        conversions: entry.sale_count,
        goal,
        goalProgress: goal > 0 ? Math.round((entry.revenue / goal) * 100) : 0,
        position: entry.rank,
        role: base?.role ?? "",
        revenueShare: entry.revenue_share,
      };
    });
}

interface ConversionRate {
  id: string;
  name: string;
  rate: number;
  meetings: number;
  sales: number;
}

/**
 * @param filterMemberId — override the auto-filter logic:
 *   - undefined (default): auto — non-admins filter by their own id, admins get total
 *   - null: force total (no member filter, regardless of role)
 *   - string: filter by that specific team_member_id
 */
export function useDashboardMetrics(month?: number, year?: number, filterMemberId?: string | null) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { isAdmin } = useIdentity();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const myId = currentTeamMember?.id ?? null;
  const filterByMe = !isAdmin && myId;

  // Explicit override takes precedence over auto-logic
  const effectiveFilter = filterMemberId !== undefined ? filterMemberId : (filterByMe ? myId : null);

  // Dark-launch gate (U3): the canonical ledger overlay runs ONLY when the org
  // has `canonical_metrics` flipped on. Fail-closed (loading/no-org → false), so
  // the default — and the whole merge-to-prod — is the legacy path unchanged.
  const useCanonical = useFeatureFlag("canonical_metrics").enabled;

  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  // Realtime: RPC canônica de receita do mês. Invalida quando qualquer pipe
  // muda (venda fechada, reunião compareceu, proposta criada) para que TV
  // Dashboard e aba de comando reflitam em tempo real. Debounce de 2s já
  // tratado em useRealtimeSubscription.
  //
  // Assina pipeline_entries (tabela base, publicada na supabase_realtime),
  // NÃO pipe_propostas/pipe_confirmacao — essas são VIEWS compat e não podem
  // entrar em logical replication: Realtime não resolve as colunas e gera
  // churn de "invalid column for filter organization_id" + estoura o pool de
  // auth-check do serviço. pipeline_entries cobre todos os stages dos pipes.
  useRealtimeSubscription("pipeline_entries", ["dashboard-metrics"]);
  useRealtimeSubscription("leads", ["dashboard-metrics"]);

  return useQuery({
    queryKey: ["dashboard-metrics", selectedMonth, selectedYear, effectiveFilter, organizationId, useCanonical],
    queryFn: async (): Promise<DashboardMetrics> => {
      console.log("🔍 [useDashboardMetrics] Chamando RPC:", { organizationId, startStr, endStr, effectiveFilter });

      if (!organizationId) {
        console.warn("⚠️ [useDashboardMetrics] organizationId é null — retornando zeros");
        return {
          totalLeads: 0, reunioesMarcadas: 0, reunioesComparecidas: 0,
          noShow: 0, taxaNoShow: 0, vendaTotal: 0, vendaMRR: 0,
          vendaProjeto: 0, vendaSemClassificacao: 0, ticketMedio: 0, ticketMedioMRR: 0,
          ticketMedioProjeto: 0, novosClientes: 0,
          propostasEnviadas: 0, tempoMedioResposta: 0,
          vendaPrimeiroPedido: 0, vendaBaseAtiva: 0, taxaConversao: 0, dailySales: [],
        };
      }

      const { data, error } = await supabase.rpc("get_dashboard_metrics", {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
        p_filter_member_id: effectiveFilter,
      });

      if (error) {
        if (isMissingSchemaError(error)) {
          console.warn("⚠️ [useDashboardMetrics] RPC ausente (migration pendente?):", error.message);
          return EMPTY_DASHBOARD_METRICS;
        }
        console.error("❌ [useDashboardMetrics] RPC error:", error.message, error.code, error.details, error.hint);
        throw new Error(`Dashboard metrics failed: ${error.message}`);
      }

      console.log("📊 [useDashboardMetrics] RPC raw response:", data);

      // Supabase RPC pode retornar JSONB como array — desembrulhar
      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      const d = raw as Record<string, number> | null;
      // Base legada: dimensões sem caderno canônico nesta fatia (leads, reuniões,
      // propostas, tempo de resposta, conversão, dailySales) seguem vindo daqui.
      const legacyBase: DashboardMetrics = {
        totalLeads: d?.totalLeads ?? 0,
        reunioesMarcadas: d?.reunioesMarcadas ?? 0,
        reunioesComparecidas: d?.reunioesComparecidas ?? 0,
        noShow: d?.noShow ?? 0,
        taxaNoShow: d?.taxaNoShow ?? 0,
        vendaTotal: d?.vendaTotal ?? 0,
        vendaMRR: d?.vendaMRR ?? 0,
        vendaProjeto: d?.vendaProjeto ?? 0,
        vendaSemClassificacao: d?.vendaSemClassificacao ?? 0,
        ticketMedio: d?.ticketMedio ?? 0,
        ticketMedioMRR: d?.ticketMedioMRR ?? 0,
        ticketMedioProjeto: d?.ticketMedioProjeto ?? 0,
        novosClientes: d?.novosClientes ?? 0,
        propostasEnviadas: d?.propostasEnviadas ?? 0,
        tempoMedioResposta: d?.tempoMedioResposta ?? 0,
        vendaPrimeiroPedido: d?.vendaPrimeiroPedido ?? 0,
        vendaBaseAtiva: d?.vendaBaseAtiva ?? 0,
        taxaConversao: d?.taxaConversao ?? 0,
        dailySales: (d?.dailySales as any[]) ?? [],
      };
      // Gate (U3): flag OFF/loading → legacy money only, canonical RPC never called.
      if (!useCanonical) return legacyBase;
      // Receita (venda) → caderno canônico sale_events, líquida de estorno (ADR-0017).
      // TODO(design #998): vendaMRR/vendaProjeto (eixo Recorrência×Projeto do
      //   SalesBreakdown) NÃO têm equivalente canônico — o eixo canônico é
      //   novo_negocio×carteira (FirstOrderVsBase). Mantidos legados até o eixo
      //   MRR/Projeto ganhar um caderno próprio; podem divergir de vendaTotal
      //   canônico durante o backfill (portão de reconciliação, ADR-0018).
      return overlayCanonicalSales(legacyBase, organizationId, selectedMonth, selectedYear, effectiveFilter);
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 minutos — métricas sobrevivem navegação entre páginas
  });
}

export function useConversionRates(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["conversion-rates", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      if (!organizationId) return { meetingsRates: [], salesRates: [] };
      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("id, name, role, metric_type")
        .eq("organization_id", organizationId)
        .eq("is_active", true);

      const salesMembers = teamMembers?.filter((m) => m.metric_type === "sales") || [];
      const meetingsMembers = teamMembers?.filter((m) => m.metric_type === "meetings") || [];

      // Reuniões: meeting_events (ADR-0007) — marcadas no mês da marcação,
      // realizadas no mês da reunião. Atribuição = snapshot do pré-vendas no evento.
      const { data: meetingEvents } = await supabase
        .from("meeting_events")
        .select("id, event_type, pre_sale_responsible_id, booked_event_id, occurred_at, meeting_date")
        .eq("organization_id", organizationId);

      // Propostas: TODOS os leads no pipe (sem filtro de período) para taxa de conversão correta
      const { data: propostasData } = await supabase
        .from("negocio_projetado")
        .select("sale_responsible_id, responsible_id, closer_id, stage_key")
        .eq("funil_sistema", "propostas")
        .eq("organization_id", organizationId);

      const meetingsRates: ConversionRate[] = computeMeetingRates(
        (meetingEvents ?? []) as MeetingEventLike[],
        meetingsMembers,
        { start: startStr, end: endStr },
      );

      // Calculate sales conversion: TODOS no pipe X vendido
      const salesRates: ConversionRate[] = salesMembers.map((member) => {
        const total = (propostasData || []).filter((p) => ((p as any).sale_responsible_id || p.responsible_id || p.closer_id) === member.id).length;
        const vendidas = (propostasData || []).filter(
          (p) => ((p as any).sale_responsible_id || p.responsible_id || p.closer_id) === member.id && p.stage_key === "vendido"
        ).length;
        return {
          id: member.id,
          name: member.name,
          meetings: total,
          sales: vendidas,
          rate: total > 0 ? (vendidas / total) * 100 : 0,
        };
      });

      return { meetingsRates, salesRates };
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * TODO(#998 — canonical funnel deferred): the canonical funnel leitor is
 * get_funnel_flow (#996 / ADR-0017), but it REQUIRES a p_pipeline_id (funil é
 * por-pipeline — mata R3) and returns a cohort/flow shape (open→booked→held→won)
 * with NO "propostas" role. This hook (and the dashboard's org-wide funnel) has
 * no pipeline in scope and shows a "Propostas" step, so it cannot map cleanly
 * without a pipeline selector (redesign — out of scope here). Kept on the legacy
 * get_dashboard_metrics until a pipeline picker lands. NB: this hook currently
 * has no consumers (TabVisaoGeral derives its funnel inline from totalMetrics).
 */
export function useFunnelData(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["funnel-data", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      const empty = [
        { label: "Leads", value: 0, color: "hsl(var(--primary))" },
        { label: "Reuniões Marcadas", value: 0, color: "hsl(var(--chart-2))" },
        { label: "Compareceu", value: 0, color: "hsl(var(--chart-3))" },
        { label: "Propostas", value: 0, color: "hsl(var(--chart-4))" },
        { label: "Vendas", value: 0, color: "hsl(var(--chart-5))" },
      ];
      if (!organizationId) return empty;

      const { data, error } = await supabase.rpc("get_dashboard_metrics", {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
        p_filter_member_id: null,
      });

      if (error) {
        if (isMissingSchemaError(error)) {
          console.warn("⚠️ [useFunnelData] RPC ausente (migration pendente?):", error.message);
          return empty;
        }
        console.error("[useFunnelData] RPC error:", error);
        throw new Error(`Funnel data failed: ${error.message}`);
      }

      // Supabase RPC pode retornar JSONB como array — desembrulhar
      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      const d = raw as Record<string, number> | null;
      return [
        { label: "Leads", value: d?.totalLeads ?? 0, color: "hsl(var(--primary))" },
        { label: "Reuniões Marcadas", value: d?.funnelReunioesMarcadas ?? 0, color: "hsl(var(--chart-2))" },
        { label: "Compareceu", value: d?.funnelCompareceu ?? 0, color: "hsl(var(--chart-3))" },
        { label: "Propostas", value: d?.funnelPropostas ?? 0, color: "hsl(var(--chart-4))" },
        { label: "Vendas", value: d?.funnelVendas ?? 0, color: "hsl(var(--chart-5))" },
      ];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Ranking do pódio — sempre busca dados frescos (staleTime: 0) para refletir atualizações da RPC.
 *
 * @param rangeOverride — intervalo arbitrário (Comando period-aware). Quando
 *   presente: (a) o overlay CANÔNICO get_ranking passa a ser range-aware
 *   (rangePeriodArgs); (b) month/year — quando não explícitos — são derivados
 *   do início do range pro fallback legado.
 *
 *   ⚠️ LIMITAÇÃO: o get_ranking_data LEGADO é travado no mês (calcula o
 *   intervalo do 1º ao último dia a partir de p_month/p_year) e NÃO aceita
 *   range. Logo, com `canonical_metrics` OFF (default dark-launch) o ranking
 *   permanece MENSAL mesmo com range sub-mês. A reatividade real ao período
 *   só existe com a flag canônica ON (via get_ranking). O meetingsRanking é
 *   100% legado → sempre mensal. Backend fora de escopo desta fatia.
 */
export function useRankingData(
  month?: number,
  year?: number,
  rangeOverride?: { start: Date; end: Date } | null,
) {
  const now = new Date();
  // Sem month/year explícito, deriva do início do range (fallback legado mensal);
  // sem nenhum dos dois, cai no mês corrente — comportamento original.
  const selectedMonth = month ?? (rangeOverride ? rangeOverride.start.getUTCMonth() + 1 : now.getMonth() + 1);
  const selectedYear = year ?? (rangeOverride ? rangeOverride.start.getUTCFullYear() : now.getFullYear());
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const useCanonical = useFeatureFlag("canonical_metrics").enabled;

  // Args de período do overlay canônico: override → range; senão o mês.
  const periodArgs = rangeOverride
    ? rangePeriodArgs(rangeOverride.start, rangeOverride.end)
    : monthPeriodArgs(selectedMonth, selectedYear);
  const rangeKey = rangeOverride
    ? `${rangeOverride.start.toISOString()}_${rangeOverride.end.toISOString()}`
    : `${selectedMonth}-${selectedYear}`;

  // Single subscription — pipeline_entries (tabela base publicada) cobre os
  // stages de propostas, driver primário do ranking. NÃO assinar pipe_propostas:
  // view não replica e estoura o pool de Realtime (ver useDashboardMetrics).
  useRealtimeSubscription("pipeline_entries", ["ranking-data"]);

  return useQuery({
    queryKey: ["ranking-data", selectedMonth, selectedYear, rangeKey, organizationId, useCanonical],
    queryFn: async () => {
      if (!organizationId) return { salesRanking: [], meetingsRanking: [] };

      const { data, error } = await supabase.rpc("get_ranking_data", {
        p_month: selectedMonth,
        p_year: selectedYear,
        p_organization_id: organizationId,
      });

      if (error) {
        if (isMissingSchemaError(error)) {
          console.warn("⚠️ [useRankingData] RPC ausente (migration pendente?):", error.message);
          return { salesRanking: [], meetingsRanking: [] };
        }
        console.error("[useRankingData] RPC error:", error);
        throw new Error(`Ranking data failed: ${error.message}`);
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;

      const legacySalesRanking = (raw?.salesRanking ?? []) as Array<{
        id: string;
        name: string | null;
        job_title: string | null;
        metric_type: string;
        value: number;
        conversions: number;
        goal: number;
        goalProgress: number;
        position: number;
        role: string;
        revenueShare?: number;
      }>;

      // Pódio de VENDA → leaderboard canônico get_ranking (#997 / ADR-0017). Money,
      // contagem e posição vêm do caderno sale_events com atribuição por chave ÚNICA
      // (sale_responsible_id) — mata R5 (soma-por-membro == total) e R3 (funil custom
      // rankeia igual). Nome/cargo/meta são enriquecidos a partir da linha legada
      // (mesmo id): a chave canônica é subconjunto da OR-chain legada, então todo
      // membro canônico existe na base legada. Metas seguem legadas (fora do #997).
      // meetingsRanking permanece 100% legado — get_ranking é só venda por decisão
      // de escopo (#997); ranking de reunião é fatia posterior.
      // Degrada: RPC ausente (migration pendente) → mantém o pódio legado intacto.
      // Gate (U3): flag OFF/loading → pódio legado, get_ranking nunca é chamado.
      const salesRanking = useCanonical
        ? await overlayCanonicalRanking(legacySalesRanking, organizationId, periodArgs)
        : legacySalesRanking;

      return {
        salesRanking,
        meetingsRanking: (raw?.meetingsRanking ?? []) as Array<{
          id: string;
          name: string | null;
          job_title: string | null;
          metric_type: string;
          /** Placeholder na RPC (sempre 0) — usar `meetings`/`meetingsBooked`. */
          value: number;
          /** Reuniões realizadas (meeting_held, ADR-0007). */
          meetings: number;
          /** Reuniões marcadas (meeting_booked, ADR-0007). */
          meetingsBooked?: number;
          /** Meta de marcadas (goals type reunioes_marcadas). */
          goalBooked?: number;
          goalBookedProgress?: number;
          goal: number;
          goalProgress: number;
          position: number;
          role: string;
        }>,
      };
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 minutos — ranking atualiza via realtime subscription
    refetchOnMount: true,
  });
}
