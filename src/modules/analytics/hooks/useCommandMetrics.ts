import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIdentity } from "@/modules/identity";
import { useCurrentTeamMember } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { isMissingSchemaError } from "@/lib/rpc-errors";
import { startOfUTCDay, endOfUTCDay } from "@/modules/analytics/lib/utc-day";

export type CommandPeriod = "today" | "week" | "month" | "quarter" | "custom";

/**
 * Intervalo arbitrário do preset "Personalizado". Mesma forma do `DateRange`
 * do react-day-picker (Calendar mode="range") — `to` fica indefinido enquanto
 * o usuário só clicou na data inicial. Datas em horário local (meia-noite);
 * `computePeriodRange` converte pras fronteiras UTC canônicas.
 */
export interface CommandCustomRange {
  from: Date;
  to?: Date;
}

export interface CommandMetrics {
  totalLeads: number;
  reunioesMarcadas: number;
  reunioesComparecidas: number;
  noShow: number;
  taxaNoShow: number;
  vendaTotal: number;
  vendaMRR: number;
  vendaProjeto: number;
  ticketMedio: number;
  novosClientes: number;
  propostasEnviadas: number;
  tempoMedioResposta: number;
  vendaPrimeiroPedido: number;
  vendaBaseAtiva: number;
  taxaConversao: number;
  dailySales: Array<{ day: string; revenue: number; count: number }>;
  funnelReunioesMarcadas: number;
  funnelCompareceu: number;
  funnelPropostas: number;
  funnelVendas: number;
}

const EMPTY: CommandMetrics = {
  totalLeads: 0, reunioesMarcadas: 0, reunioesComparecidas: 0, noShow: 0,
  taxaNoShow: 0, vendaTotal: 0, vendaMRR: 0, vendaProjeto: 0, ticketMedio: 0,
  novosClientes: 0, propostasEnviadas: 0, tempoMedioResposta: 0,
  vendaPrimeiroPedido: 0, vendaBaseAtiva: 0, taxaConversao: 0, dailySales: [],
  funnelReunioesMarcadas: 0, funnelCompareceu: 0, funnelPropostas: 0, funnelVendas: 0,
};

export interface PeriodRange {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  /** Dias corridos do período (1-based, clampado ao total). */
  dayOfPeriod: number;
  daysTotal: number;
  /** Rótulo do período anterior pra captions ("em maio", "ontem", ...). */
  prevLabel: string;
}

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Calcula o intervalo do período + intervalo equivalente anterior (pros deltas).
 * `month`/`year` só são usados quando period === "month" (navegação de meses).
 * `customRange` só é usado quando period === "custom" (intervalo livre).
 */
export function computePeriodRange(
  period: CommandPeriod,
  month: number,
  year: number,
  customRange?: CommandCustomRange | null,
): PeriodRange {
  const now = new Date();

  if (period === "custom") {
    // Contrato non-null: os callers derreferenciam `range.start` sem guard.
    // Sem intervalo completo (só `from`, ou nada), cai pro mês corrente em vez
    // de retornar null — evita crash enquanto o range está sendo escolhido.
    if (!customRange?.from || !customRange?.to) {
      return computePeriodRange("month", month, year);
    }
    const DAY_MS = 86400000;
    const start = startOfUTCDay(customRange.from);
    const end = endOfUTCDay(customRange.to);
    // daysTotal a partir das meia-noites UTC (múltiplos exatos de DAY_MS).
    const daysTotal =
      Math.round((startOfUTCDay(customRange.to).getTime() - start.getTime()) / DAY_MS) + 1;
    // Janela imediatamente anterior, mesma duração: termina no dia anterior ao start.
    const prevEndMidnight = start.getTime() - DAY_MS;
    const prevStart = new Date(prevEndMidnight - (daysTotal - 1) * DAY_MS);
    const prevEnd = new Date(prevEndMidnight + (DAY_MS - 1));
    // dias decorridos até hoje dentro do range (1-based), clampado a [1, daysTotal].
    // Range todo no passado → daysTotal; range todo no futuro → 1.
    const elapsed = Math.floor((startOfUTCDay(now).getTime() - start.getTime()) / DAY_MS) + 1;
    const dayOfPeriod = Math.max(1, Math.min(elapsed, daysTotal));
    return { start, end, prevStart, prevEnd, dayOfPeriod, daysTotal, prevLabel: "período anterior" };
  }

  if (period === "today") {
    const start = startOfUTCDay(now);
    const end = endOfUTCDay(now);
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    return {
      start, end,
      prevStart: startOfUTCDay(yest), prevEnd: endOfUTCDay(yest),
      dayOfPeriod: 1, daysTotal: 1, prevLabel: "ontem",
    };
  }

  if (period === "week") {
    // Semana ISO: segunda → domingo
    const dow = (now.getDay() + 6) % 7; // 0 = segunda
    const monday = new Date(now); monday.setDate(now.getDate() - dow);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const prevMonday = new Date(monday); prevMonday.setDate(monday.getDate() - 7);
    const prevSunday = new Date(monday); prevSunday.setDate(monday.getDate() - 1);
    return {
      start: startOfUTCDay(monday), end: endOfUTCDay(sunday),
      prevStart: startOfUTCDay(prevMonday), prevEnd: endOfUTCDay(prevSunday),
      dayOfPeriod: dow + 1, daysTotal: 7, prevLabel: "semana passada",
    };
  }

  if (period === "quarter") {
    const q = Math.floor(now.getMonth() / 3); // 0..3
    const start = new Date(Date.UTC(now.getFullYear(), q * 3, 1));
    const end = new Date(Date.UTC(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999));
    const prevStart = new Date(Date.UTC(now.getFullYear(), q * 3 - 3, 1));
    const prevEnd = new Date(Date.UTC(now.getFullYear(), q * 3, 0, 23, 59, 59, 999));
    const daysTotal = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    const dayOfPeriod = Math.min(
      Math.floor((now.getTime() - start.getTime()) / 86400000) + 1,
      daysTotal,
    );
    return { start, end, prevStart, prevEnd, dayOfPeriod, daysTotal, prevLabel: "trim. anterior" };
  }

  // month (default) — mantém o mesmo intervalo UTC do useDashboardMetrics
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevStart = new Date(Date.UTC(prevYear, prevMonth - 1, 1));
  const prevEnd = new Date(Date.UTC(prevYear, prevMonth, 0, 23, 59, 59, 999));
  const daysTotal = new Date(year, month, 0).getDate();
  const isCurrentMonth = month === new Date().getMonth() + 1 && year === new Date().getFullYear();
  const dayOfPeriod = isCurrentMonth ? new Date().getDate() : daysTotal;
  return {
    start, end, prevStart, prevEnd, dayOfPeriod, daysTotal,
    prevLabel: `em ${MONTH_SHORT[prevMonth - 1]}`,
  };
}

function mapMetrics(data: unknown): CommandMetrics {
  const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
  const d = raw as Record<string, number> | null;
  return {
    totalLeads: d?.totalLeads ?? 0,
    reunioesMarcadas: d?.reunioesMarcadas ?? 0,
    reunioesComparecidas: d?.reunioesComparecidas ?? 0,
    noShow: d?.noShow ?? 0,
    taxaNoShow: d?.taxaNoShow ?? 0,
    vendaTotal: d?.vendaTotal ?? 0,
    vendaMRR: d?.vendaMRR ?? 0,
    vendaProjeto: d?.vendaProjeto ?? 0,
    ticketMedio: d?.ticketMedio ?? 0,
    novosClientes: d?.novosClientes ?? 0,
    propostasEnviadas: d?.propostasEnviadas ?? 0,
    tempoMedioResposta: d?.tempoMedioResposta ?? 0,
    vendaPrimeiroPedido: d?.vendaPrimeiroPedido ?? 0,
    vendaBaseAtiva: d?.vendaBaseAtiva ?? 0,
    taxaConversao: d?.taxaConversao ?? 0,
    dailySales: (d?.dailySales as unknown as CommandMetrics["dailySales"]) ?? [],
    funnelReunioesMarcadas: d?.funnelReunioesMarcadas ?? 0,
    funnelCompareceu: d?.funnelCompareceu ?? 0,
    funnelPropostas: d?.funnelPropostas ?? 0,
    funnelVendas: d?.funnelVendas ?? 0,
  };
}

/**
 * Métricas da Central de Comando com período arbitrário (hoje/semana/mês/trimestre).
 * Mesma RPC `get_dashboard_metrics` do useDashboardMetrics — esse hook NÃO substitui
 * o original (contract congelado, consumido por engagement); é a variante range-aware
 * exclusiva do Comando v2.
 *
 * @param filterMemberId — undefined: auto (membro vê o próprio, admin vê total);
 *   null: força total; string: membro específico.
 */
export function useCommandMetrics(
  range: { start: Date; end: Date },
  filterMemberId?: string | null,
) {
  const { isAdmin } = useIdentity();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const myId = currentTeamMember?.id ?? null;
  const filterByMe = !isAdmin && myId;
  const effectiveFilter = filterMemberId !== undefined ? filterMemberId : (filterByMe ? myId : null);

  const startStr = range.start.toISOString();
  const endStr = range.end.toISOString();

  useRealtimeSubscription("pipe_propostas", ["command-metrics"]);
  useRealtimeSubscription("pipe_confirmacao", ["command-metrics"]);
  useRealtimeSubscription("leads", ["command-metrics"]);

  return useQuery({
    queryKey: ["command-metrics", startStr, endStr, effectiveFilter, organizationId],
    queryFn: async (): Promise<CommandMetrics> => {
      if (!organizationId) return EMPTY;
      const { data, error } = await supabase.rpc("get_dashboard_metrics", {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
        p_filter_member_id: effectiveFilter ?? undefined,
      });
      if (error) {
        if (isMissingSchemaError(error)) {
          console.warn("[useCommandMetrics] RPC ausente (migration pendente?):", error.message);
          return EMPTY;
        }
        throw new Error(`Command metrics failed: ${error.message}`);
      }
      return mapMetrics(data);
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
