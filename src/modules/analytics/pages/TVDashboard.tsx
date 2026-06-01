import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  RefreshCw, Maximize, Clock, Users, TrendingUp,
  DollarSign, Calendar, AlertTriangle, Flame, Target,
  Zap, ArrowUpRight, ArrowDownRight, Trophy
} from "lucide-react";
import { useTVDashboardData } from "@/modules/analytics/hooks/useTVDashboardData";
import { useTVKPIs } from "@/modules/analytics/hooks/useTVKPIs";
import { AICoachSection } from "@/modules/analytics/components/tv/AICoachSection";
import { SalesFunnel } from "@/modules/analytics/components/tv/SalesFunnel";
import { TVCompetitionBlockV2 } from "@/modules/analytics/components/tv/TVCompetitionBlockV2";
import { SDRPerformanceBlock } from "@/modules/analytics/components/tv/SDRPerformanceBlock";
import { CloserPerformanceBlock } from "@/modules/analytics/components/tv/CloserPerformanceBlock";
import { NewLeadsBlock } from "@/modules/analytics/components/tv/NewLeadsBlock";
import { PeriodPill } from "@/modules/analytics/components/tv/PeriodPill";
import { RotatingSlot } from "@/modules/analytics/components/tv/RotatingSlot";
import { TVPeriodProvider, useTVPeriod } from "@/contexts/TVPeriodContext";
import { useActiveCompetition, useCompetitionParticipants, useCompetitionPrizes } from "@/modules/engagement/hooks/useCompetitions";
import { useRankingData } from "@/modules/analytics/hooks/useDashboardMetrics";
import { useAvatarMap } from "@/modules/identity/hooks/useAvatarMap";
import { Button } from "@/components/ui/button";
import torqueLogo from "@/assets/torque-logo.png";
import { TVRankingSimple } from "@/modules/analytics/components/tv/TVRankingSimple";
import { generateTVConfig } from "@/modules/platform/lib/tv-config-from-quiz";
import { useOnboarding } from "@/modules/platform/hooks/useOnboarding";

const formatCurrency = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(0);
};

export default function TVDashboard() {
  return (
    <TVPeriodProvider>
      <TVDashboardInner />
    </TVPeriodProvider>
  );
}

function TVDashboardInner() {
  const { data, isLoading, refetch } = useTVDashboardData();
  const { range } = useTVPeriod();
  const kpiValues = useTVKPIs(range);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Competition + ranking (slot rotativo Coach/Ranking)
  const now = new Date();
  const activeCompetition = useActiveCompetition(now.getMonth() + 1, now.getFullYear());
  const { data: compParticipants = [] } = useCompetitionParticipants(activeCompetition?.id ?? null);
  const { data: compPrizes = [] } = useCompetitionPrizes(activeCompetition?.id ?? null);
  const { data: rankingData } = useRankingData(now.getMonth() + 1, now.getFullYear());
  const avatarMap = useAvatarMap();

  const tvCompetitionUsers = (() => {
    if (!activeCompetition || !rankingData) return [];
    const participantIds = new Set(compParticipants.map(p => p.team_member_id));
    const source = activeCompetition.metric_type === "sales"
      ? rankingData.salesRanking
      : rankingData.meetingsRanking;
    return source
      .filter(u => participantIds.has(u.id))
      .sort((a, b) => b.value - a.value)
      .map((u, i) => ({
        id: u.id,
        name: u.name || "Sem nome",
        value: u.value,
        goalProgress: u.goalProgress,
        position: i + 1,
        avatarUrl: avatarMap.get(u.id),
      }));
  })();

  const tvCompetitionDaysLeft = activeCompetition
    ? Math.max(0, Math.ceil((new Date(activeCompetition.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const { onboarding } = useOnboarding();
  const tvConfig = generateTVConfig(onboarding?.answers);

  const simpleRankingUsers = (() => {
    if (!rankingData) return [];
    const source = rankingData.salesRanking.length > 0 ? rankingData.salesRanking : rankingData.meetingsRanking;
    return source.slice(0, 5).map((u, i) => ({
      id: u.id,
      name: u.name || "Sem nome",
      value: u.value,
      goalProgress: u.goalProgress,
      position: i + 1,
      avatarUrl: avatarMap.get(u.id),
    }));
  })();

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const interval = setInterval(() => refetchRef.current(), 30_000);
    return () => clearInterval(interval);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const monthName = format(currentTime, "MMMM 'de' yyyy", { locale: ptBR });

  if (isLoading) {
    return (
      <div className="h-screen bg-[hsl(36,20%,8%)] flex items-center justify-center">
        <div className="text-center">
          <img src={torqueLogo} alt="Torque" className="h-14 mx-auto mb-4 animate-pulse" />
          <p className="text-white/60">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  // Termômetro Meta — SEMPRE mês civil (não rotaciona)
  const meta = data?.metaVendasMes || 60000;
  const atual = data?.vendasRealizadas || 0;
  const ondeDeveria = data?.ondeDeveriamEstar || 0;
  const percentage = meta > 0 ? (atual / meta) * 100 : 0;
  const isAhead = atual >= ondeDeveria;
  const quantoFalta = Math.max(0, meta - atual);
  const diferenca = Math.abs(atual - ondeDeveria);

  return (
    <div className="h-screen bg-[hsl(36,20%,8%)] overflow-hidden flex flex-col relative">
      <div className="absolute inset-0 checkered-pattern opacity-[0.015] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <img src={torqueLogo} alt="Torque CRM" className="h-7" />
          <div className="h-6 w-px bg-white/10" />
          <div>
            <h1 className="font-display text-base font-semibold text-[#f8f5e7] tracking-tight leading-tight">Dashboard Comercial</h1>
            <p className="text-[10.5px] text-[#8a857a] capitalize">{monthName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <PeriodPill />
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#f8f5e7] tabular-nums"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <Clock className="w-[11px] h-[11px] text-[#ed9326]" />
            <span>{format(currentTime, "HH:mm")}</span>
          </div>
          <Button
            variant="ghost" size="icon"
            onClick={() => refetch()}
            className="w-7 h-7 rounded-lg text-[#8a857a] hover:text-[#f8f5e7] hover:bg-white/5"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost" size="icon"
            onClick={toggleFullscreen}
            className="w-7 h-7 rounded-lg text-[#8a857a] hover:text-[#f8f5e7] hover:bg-white/5"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <Maximize className="w-3 h-3" />
          </Button>
        </div>
      </header>

      {/* Main Grid — scrolls when the viewport is shorter than the content
          (e.g. windowed mode); fills the screen in fullscreen. */}
      <div className="relative z-10 flex-1 p-3 grid grid-cols-12 gap-3 overflow-y-auto">

        {/* Coluna esquerda — Termômetro (mês civil, fixo) */}
        <div className="col-span-3 flex flex-col gap-3">
          <TVCard className="flex-1 relative overflow-hidden">
            <Thermometer
              meta={meta}
              atual={atual}
              ondeDeveria={ondeDeveria}
              percentage={percentage}
              isAhead={isAhead}
              quantoFalta={quantoFalta}
              diferenca={diferenca}
              currentTime={currentTime}
            />
          </TVCard>
        </div>

        {/* Coluna direita */}
        <div className="col-span-9 flex flex-col gap-3">
          {/* KPI Row — resumo do período (rotaciona) */}
          <div className="grid grid-cols-6 gap-3">
            {tvConfig.kpis.map((kpi) => {
              const raw = kpiValues[kpi.key as keyof typeof kpiValues] ?? 0;
              let value: number | string = raw;
              let suffix = "";
              switch (kpi.key) {
                case "conversao":
                case "noshow":
                  value = Number(raw).toFixed(0);
                  suffix = "%";
                  break;
                case "ticket_mrr":
                case "ticket_proj":
                  value = formatCurrency(Number(raw));
                  break;
                default:
                  value = Number(raw);
              }
              const iconMap: Record<string, React.ElementType> = {
                reunioes: Calendar, conversao: TrendingUp, noshow: AlertTriangle,
                ticket_mrr: DollarSign, ticket_proj: DollarSign, leads: Users,
                leads_novos: Users, propostas: Flame, base_ativa: Users, respostas: Zap,
              };
              return (
                <KPICard
                  key={kpi.key}
                  icon={iconMap[kpi.key] || Target}
                  label={kpi.label}
                  value={value}
                  suffix={suffix}
                  color={kpi.color}
                />
              );
            })}
          </div>

          {/* Linha 2: SDR + Closer + Coach/Ranking rotativo */}
          <div className="grid grid-cols-12 gap-3" style={{ minHeight: "280px" }}>
            <TVCard className="col-span-5 flex flex-col">
              <SDRPerformanceBlock />
            </TVCard>

            <TVCard className="col-span-4 flex flex-col">
              <CloserPerformanceBlock />
            </TVCard>

            <TVCard className="col-span-3 flex flex-col" accent="purple">
              <RotatingSlot
                panels={[
                  {
                    id: "coach",
                    render: () => (
                      <div className="h-full flex flex-col">
                        <div className="flex items-center gap-2 mb-3">
                          <motion.div
                            animate={{ scale: [1, 1.15, 1] }}
                            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                          >
                            <Zap className="w-5 h-5 text-purple-400" />
                          </motion.div>
                          <span className="text-sm font-bold text-white uppercase tracking-wider">Coach IA</span>
                          <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">IA</span>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          <AICoachSection />
                        </div>
                      </div>
                    ),
                  },
                  {
                    id: "ranking",
                    render: () => (
                      <div className="h-full">
                        {activeCompetition && tvCompetitionUsers.length > 0 ? (
                          <TVCompetitionBlockV2
                            competitionName={activeCompetition.name}
                            daysLeft={tvCompetitionDaysLeft}
                            users={tvCompetitionUsers}
                            prizes={compPrizes.map(p => ({
                              position: p.position,
                              prize_name: p.prize_name,
                              prize_icon: p.prize_icon,
                              prize_value: p.prize_value,
                            }))}
                            metricType={activeCompetition.metric_type}
                            participantCount={compParticipants.length}
                          />
                        ) : (
                          <TVRankingSimple
                            users={simpleRankingUsers}
                            metricType={simpleRankingUsers[0]?.value != null ? "sales" : "meetings"}
                          />
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </TVCard>
          </div>

          {/* Linha 3: NovosLeads + Funil (mês fixo) */}
          <div className="grid grid-cols-12 gap-3" style={{ minHeight: "240px" }}>
            <TVCard className="col-span-5 flex flex-col" accent="emerald">
              <NewLeadsBlock />
            </TVCard>

            <TVCard className="col-span-7 flex flex-col">
              <SalesFunnel
                reunioesMarcadas={data?.funnel?.reunioesMarcadas || 0}
                comparecidas={data?.funnel?.comparecidas || 0}
                marcandoR2={data?.funnel?.marcandoR2 || 0}
                marcandoR2Value={data?.funnel?.marcandoR2Value || 0}
                r2Marcadas={data?.funnel?.r2Marcadas || 0}
                r2MarcadasValue={data?.funnel?.r2MarcadasValue || 0}
                vendido={data?.funnel?.vendido || 0}
                vendidoValue={data?.funnel?.vendidoValue || 0}
              />
            </TVCard>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Termômetro extraído
// ──────────────────────────────────────────────────────

interface ThermometerProps {
  meta: number;
  atual: number;
  ondeDeveria: number;
  percentage: number;
  isAhead: boolean;
  quantoFalta: number;
  diferenca: number;
  currentTime: Date;
}

function Thermometer({ meta, atual, ondeDeveria, percentage, isAhead, quantoFalta, diferenca, currentTime }: ThermometerProps) {
  const pct = Math.min(percentage, 100);
  const monthUpper = format(currentTime, "MMMM", { locale: ptBR }).toUpperCase();

  return (
    <div className="h-full flex flex-col">
      {/* Top pill */}
      <div className="flex items-center justify-center mb-3">
        <span
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#f8f5e7]"
          style={{ background: "rgba(237,147,38,0.12)", border: "1px solid rgba(237,147,38,0.3)" }}
        >
          <Target className="w-3 h-3 text-[#ed9326]" />
          META DE {monthUpper}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 flex gap-2 min-h-[260px]">
        {/* ticks */}
        <div className="flex flex-col justify-between items-end text-[8px] text-[#8a857a] py-1 w-9 shrink-0 tabular-nums">
          {[100, 75, 50, 25, 0].map((p) => (
            <span key={p}>{p === 0 ? "0" : formatCurrency((meta * p) / 100)}</span>
          ))}
        </div>

        {/* track */}
        <div className="relative flex-1 flex justify-center">
          {/* top meta label */}
          <div
            className="absolute -top-1 left-1/2 -translate-x-1/2 z-20 text-center px-3 py-2 rounded-xl shadow-lg"
            style={{ background: "linear-gradient(135deg,#ed9326,#ffd400)" }}
          >
            <div className="font-display text-sm font-bold text-[#1c1c1c] leading-none">
              R$ {formatCurrency(meta)}
            </div>
            <div className="text-[7.5px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: "rgba(28,28,28,0.7)" }}>
              {percentage >= 100 ? "Meta batida!" : "Meta do mês"}
            </div>
          </div>

          {/* tube */}
          <div
            className="relative w-7 mt-14 mb-1 rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            {/* "onde deveria estar" marker */}
            <div
              className="absolute inset-x-0 h-px bg-white/40 z-10"
              style={{ bottom: `${Math.min((ondeDeveria / meta) * 100, 100)}%` }}
            />
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${pct}%` }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className="absolute bottom-0 inset-x-0 rounded-full"
              style={{ background: "linear-gradient(180deg,#ffd400,#ed9326)", boxShadow: "0 0 16px rgba(237,147,38,0.5)" }}
            />
          </div>

          {/* base bubble */}
          <motion.div
            animate={{
              boxShadow: [
                "0 0 12px rgba(237,147,38,0.35)",
                "0 0 22px rgba(237,147,38,0.6)",
                "0 0 12px rgba(237,147,38,0.35)",
              ],
            }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="absolute bottom-1 left-1/2 -translate-x-1/2 z-20 w-12 h-12 rounded-full flex flex-col items-center justify-center text-center"
            style={{ background: "radial-gradient(circle at 50% 35%,#ffb347,#ed9326)" }}
          >
            <div className="font-display text-[13px] font-bold text-[#1c1c1c] leading-none">{percentage.toFixed(0)}%</div>
            <div className="text-[6.5px] font-semibold uppercase" style={{ color: "rgba(28,28,28,0.7)" }}>atingido</div>
          </motion.div>

          {/* vendido tag */}
          <div
            className="absolute bottom-3 right-0 z-20 flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-semibold text-[#1c1c1c]"
            style={{ background: "linear-gradient(135deg,#ed9326,#ffd400)" }}
          >
            <ArrowUpRight className="w-2 h-2" />
            R$ {formatCurrency(atual)}
          </div>
        </div>
      </div>

      {/* footer */}
      <div
        className="mt-3 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-medium"
        style={
          isAhead
            ? { background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#4ade80" }
            : { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }
        }
      >
        {isAhead ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
        R$ {formatCurrency(diferenca)} {isAhead ? "acima" : "atrás"}
      </div>

      {quantoFalta > 0 && (
        <p className="mt-1.5 text-[10px] text-[#8a857a] text-center">
          Falta <span className="font-bold text-[#f8f5e7]">R$ {formatCurrency(quantoFalta)}</span> para a meta
        </p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// TVCard + KPICard
// ──────────────────────────────────────────────────────

function TVCard({
  children,
  className = "",
  accent
}: {
  children: React.ReactNode;
  className?: string;
  accent?: "purple" | "orange" | "emerald";
}) {
  const accentClasses = {
    purple: "border-purple-500/20 bg-purple-500/[0.02]",
    orange: "border-orange-500/20 bg-orange-500/[0.02]",
    emerald: "border-emerald-500/20 bg-emerald-500/[0.02]",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className={`
        p-3 rounded-xl
        bg-white/[0.022] border border-white/5
        backdrop-blur-sm
        ${accent ? accentClasses[accent] : ""}
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}

function KPICard({
  icon: Icon,
  label,
  value,
  prefix = "",
  suffix = "",
  color
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  prefix?: string;
  suffix?: string;
  color: string;
}) {
  const colorMap: Record<string, { icon: string; text: string }> = {
    blue: { icon: "text-blue-400", text: "text-blue-400" },
    emerald: { icon: "text-emerald-400", text: "text-emerald-400" },
    amber: { icon: "text-amber-400", text: "text-amber-400" },
    red: { icon: "text-red-400", text: "text-red-400" },
    purple: { icon: "text-purple-400", text: "text-purple-400" },
    orange: { icon: "text-orange-400", text: "text-orange-400" },
    primary: { icon: "text-primary", text: "text-primary" },
  };

  const colors = colorMap[color] || colorMap.primary;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -2 }}
      className="p-2.5 rounded-xl transition-all cursor-default"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] text-[#8a857a] uppercase tracking-wider leading-tight">{label}</span>
        <Icon className={`w-2.5 h-2.5 ${colors.icon}`} />
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={String(value)}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className={`font-display text-lg font-semibold tabular-nums ${colors.text}`}
        >
          {prefix}{value}{suffix}
        </motion.p>
      </AnimatePresence>
    </motion.div>
  );
}
