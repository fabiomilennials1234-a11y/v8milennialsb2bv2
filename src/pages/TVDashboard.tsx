import { useEffect, useState, useRef } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  RefreshCw, Maximize, Clock, Users, TrendingUp, 
  DollarSign, Calendar, AlertTriangle, Flame, Target,
  Zap, ArrowUpRight, ArrowDownRight
} from "lucide-react";
import { useTVDashboardData } from "@/hooks/useTVDashboardData";
import { AICoachSection } from "@/components/tv/AICoachSection";
import { SalesFunnel } from "@/components/tv/SalesFunnel";
import { Button } from "@/components/ui/button";
import torqueLogo from "@/assets/torque-logo.png";

// Animated counter component
function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 0 }: { 
  value: number; 
  prefix?: string; 
  suffix?: string;
  decimals?: number;
}) {
  const spring = useSpring(0, { stiffness: 50, damping: 20 });
  const display = useTransform(spring, (v) => {
    if (decimals > 0) return `${prefix}${v.toFixed(decimals)}${suffix}`;
    return `${prefix}${Math.round(v).toLocaleString('pt-BR')}${suffix}`;
  });

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  return <motion.span>{display}</motion.span>;
}

export default function TVDashboard() {
  const { data, isLoading, refetch } = useTVDashboardData();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60_000); // 1x por minuto (era 1x por segundo)
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => refetch(), 30_000); // 1x a cada 30s (era 5s)
    return () => clearInterval(interval);
  }, [refetch]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toFixed(0);
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

  const meta = data?.metaVendasMes || 60000;
  const atual = data?.vendasRealizadas || 0;
  const ondeDeveria = data?.ondeDeveriamEstar || 0;
  const percentage = meta > 0 ? (atual / meta) * 100 : 0;
  const isAhead = atual >= ondeDeveria;
  const quantoFalta = Math.max(0, meta - atual);
  const diferenca = Math.abs(atual - ondeDeveria);
  const closers = data?.individualGoals?.closers || [];
  const sdrs = data?.individualGoals?.sdrs || [];

  return (
    <div className="h-screen bg-[hsl(36,20%,8%)] overflow-hidden flex flex-col">
      {/* Header - Clean & Minimal */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-4">
          <img src={torqueLogo} alt="Torque CRM" className="h-8" />
          <div className="h-6 w-px bg-white/10" />
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">
              Dashboard Comercial
            </h1>
            <p className="text-xs text-white/40 capitalize">{monthName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/5">
            <Clock className="w-4 h-4 text-primary" />
            <span className="text-lg font-mono font-semibold text-white">
              {format(currentTime, "HH:mm")}
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()} className="text-white/60 hover:text-white hover:bg-white/5">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="text-white/60 hover:text-white hover:bg-white/5">
            <Maximize className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="flex-1 p-3 grid grid-cols-12 gap-3 overflow-hidden">

        {/* Left Column - Meta do Mês */}
        <div className="col-span-3 flex flex-col gap-3">
          <TVCard className="flex-1 relative overflow-hidden">
            <div className="h-full flex flex-col">
              {/* Header with Month */}
              <div className="text-center mb-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
                  <Target className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold text-primary uppercase tracking-wider">
                    Meta de {format(currentTime, "MMMM", { locale: ptBR })}
                  </span>
                </div>
              </div>

              {/* THERMOMETER - Full Height */}
              <div className="flex-1 flex items-stretch gap-3 min-h-0">
                {/* Scale Labels - Left Side */}
                <div className="flex flex-col justify-between py-2 text-right w-10">
                  {[100, 75, 50, 25, 0].map((p) => (
                    <span key={p} className="text-[10px] font-mono text-white/50">
                      {formatCurrency((meta * p) / 100)}
                    </span>
                  ))}
                </div>

                {/* Thermometer Tube Container */}
                <div className="relative flex flex-col items-center flex-1 py-2">
                  {/* TOP GOAL - Gamified Target */}
                  <motion.div
                    animate={{
                      scale: percentage >= 100 ? [1, 1.2, 1] : 1,
                      boxShadow: percentage >= 100
                        ? ["0 0 0px rgba(234,179,8,0.5)", "0 0 40px rgba(234,179,8,0.8)", "0 0 0px rgba(234,179,8,0.5)"]
                        : "none"
                    }}
                    transition={{ repeat: percentage >= 100 ? Infinity : 0, duration: 1 }}
                    className={`relative -mb-3 z-20 px-4 py-2 rounded-xl border-2 ${
                      percentage >= 100
                        ? "bg-gradient-to-br from-yellow-400 via-amber-500 to-orange-500 border-yellow-300 shadow-2xl shadow-yellow-500/30"
                        : "bg-gradient-to-br from-primary/80 to-primary border-primary/50"
                    }`}
                  >
                    {percentage >= 100 && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: [0, 1.5, 0], opacity: [1, 1, 0] }}
                        transition={{ repeat: Infinity, duration: 2, delay: 0.5 }}
                        className="absolute inset-0 rounded-xl bg-yellow-400/50"
                      />
                    )}
                    <p className="text-2xl font-black text-white drop-shadow-lg text-center">
                      R$ {formatCurrency(meta)}
                    </p>
                    <p className="text-[10px] font-medium text-white/80 text-center">
                      {percentage >= 100 ? "META BATIDA!" : "Meta do Mês"}
                    </p>
                  </motion.div>

                  {/* Tube */}
                  <div className="relative w-16 flex-1 rounded-t-full bg-white/[0.08] border-2 border-white/20 overflow-hidden">
                    {/* Grid lines */}
                    {[25, 50, 75].map((p) => (
                      <div key={p} className="absolute left-0 right-0 h-px bg-white/15" style={{ bottom: `${p}%` }} />
                    ))}

                    {/* Expected position marker */}
                    <motion.div
                      initial={{ bottom: 0 }}
                      animate={{ bottom: `${Math.min((ondeDeveria / meta) * 100, 100)}%` }}
                      transition={{ duration: 1, delay: 0.3 }}
                      className="absolute left-0 right-0 h-1 bg-white/40 z-10"
                    >
                      <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-0 h-0 border-t-[5px] border-b-[5px] border-l-[7px] border-transparent border-l-white/40" />
                    </motion.div>

                    {/* Fill */}
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.min(percentage, 100)}%` }}
                      transition={{ duration: 1.5, ease: "easeOut" }}
                      className={`absolute bottom-0 left-1 right-1 rounded-t-full ${
                        isAhead
                          ? "bg-gradient-to-t from-emerald-600 via-emerald-500 to-emerald-400"
                          : "bg-gradient-to-t from-amber-600 via-amber-500 to-yellow-400"
                      }`}
                    >
                      {/* Shine effect */}
                      <div className="absolute inset-y-0 left-1.5 w-1.5 bg-white/25 rounded-full" />

                      {/* Bubbles animation */}
                      <motion.div
                        animate={{ y: [0, -10, 0] }}
                        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                        className="absolute bottom-4 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white/20"
                      />
                    </motion.div>
                  </div>

                  {/* Bulb at bottom */}
                  <motion.div
                    animate={{
                      boxShadow: isAhead
                        ? ["0 0 10px rgba(16,185,129,0.4)", "0 0 25px rgba(16,185,129,0.7)", "0 0 10px rgba(16,185,129,0.4)"]
                        : ["0 0 10px rgba(245,158,11,0.4)", "0 0 25px rgba(245,158,11,0.7)", "0 0 10px rgba(245,158,11,0.4)"]
                    }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className={`-mt-2 w-18 h-18 rounded-full flex flex-col items-center justify-center z-10 border-3 shrink-0 ${
                      isAhead
                        ? "bg-gradient-to-br from-emerald-400 to-emerald-600 border-emerald-400/50"
                        : "bg-gradient-to-br from-amber-400 to-amber-600 border-amber-400/50"
                    }`}
                    style={{ width: 72, height: 72 }}
                  >
                    <span className="text-xl font-black text-white drop-shadow-md">
                      {percentage.toFixed(0)}%
                    </span>
                    <span className="text-[9px] text-white/80 font-medium">atingido</span>
                  </motion.div>
                </div>

                {/* Current Value Label - Right Side */}
                <div className="relative w-24 py-2">
                  <motion.div
                    initial={{ bottom: "0%" }}
                    animate={{ bottom: `${Math.max(5, Math.min(percentage - 8, 85))}%` }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                    className="absolute left-0 right-0"
                  >
                    <div className="flex items-center gap-1">
                      <div className={`w-0 h-0 border-t-[6px] border-b-[6px] border-r-[8px] border-transparent ${
                        isAhead ? "border-r-emerald-500" : "border-r-amber-500"
                      }`} />
                      <motion.div
                        animate={{ scale: [1, 1.02, 1] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                        className={`px-2 py-1.5 rounded-lg font-bold text-sm shadow-lg ${
                          isAhead ? "bg-emerald-500 text-white" : "bg-amber-500 text-black"
                        }`}
                      >
                        R$ {formatCurrency(atual)}
                      </motion.div>
                    </div>
                    <p className="text-[9px] text-white/40 mt-0.5 ml-3">vendido</p>
                  </motion.div>
                </div>
              </div>

              {/* Status Bar */}
              <div className={`mt-2 py-2 px-3 rounded-lg flex items-center justify-center gap-2 ${
                isAhead
                  ? "bg-emerald-500/15 border border-emerald-500/30"
                  : "bg-amber-500/15 border border-amber-500/30"
              }`}>
                {isAhead ? (
                  <>
                    <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-bold text-emerald-400">
                      +R$ {formatCurrency(diferenca)} acima
                    </span>
                  </>
                ) : (
                  <>
                    <ArrowDownRight className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-bold text-amber-400">
                      -R$ {formatCurrency(diferenca)} atrás
                    </span>
                  </>
                )}
              </div>

              {/* How much is missing */}
              {quantoFalta > 0 && (
                <p className="mt-1.5 text-xs text-white/50 text-center">
                  Falta <span className="font-bold text-white">R$ {formatCurrency(quantoFalta)}</span> para a meta
                </p>
              )}
            </div>
          </TVCard>
        </div>

        {/* Middle/Right - KPIs + Individual Goals + Everything else */}
        <div className="col-span-9 flex flex-col gap-3">
          {/* KPIs Row - Compact */}
          <div className="grid grid-cols-6 gap-3">
            <KPICard 
              icon={Calendar}
              label="Reuniões"
              value={data?.reunioesComparecidas || 0}
              color="blue"
            />
            <KPICard 
              icon={TrendingUp}
              label="Conversão"
              value={(data?.taxaConversaoGeral || 0).toFixed(0)}
              suffix="%"
              color="emerald"
            />
            <KPICard 
              icon={AlertTriangle}
              label="No-Show"
              value={(data?.noShowGeral || 0).toFixed(0)}
              suffix="%"
              color={(data?.noShowGeral || 0) > 30 ? "red" : "amber"}
            />
            <KPICard 
              icon={DollarSign}
              label="Ticket MRR"
              value={formatCurrency(data?.ticketMedioMRR || 0)}
              prefix="R$ "
              color="primary"
            />
            <KPICard 
              icon={DollarSign}
              label="Ticket Proj"
              value={formatCurrency(data?.ticketMedioProjeto || 0)}
              prefix="R$ "
              color="purple"
            />
            <KPICard 
              icon={Users}
              label="Leads"
              value={data?.leadsParaTrabalhar || 0}
              color={(data?.leadsParaTrabalhar || 0) > 15 ? "red" : "emerald"}
            />
          </div>

          {/* Main Content Area - Grid */}
          <div className="flex-1 grid grid-cols-3 gap-3 min-h-0">
            {/* Left Side - Sales Funnel */}
            <TVCard className="flex flex-col">
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

            {/* Middle - Individual Goals */}
            <TVCard className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                <span className="text-sm font-bold text-white uppercase tracking-wider">Metas Individuais</span>
              </div>

              <div className="flex-1 grid grid-cols-2 gap-3 overflow-y-auto">
                {/* Closers */}
                <div className="flex flex-col">
                  <p className="text-xs text-white/50 uppercase tracking-wider mb-2 font-semibold">Closers</p>
                  <div className="space-y-2 flex-1">
                    {closers.map((closer: any, i: number) => (
                      <GoalBar key={closer.id} data={closer} index={i} type="closer" formatCurrency={formatCurrency} />
                    ))}
                    {closers.length === 0 && <p className="text-xs text-white/30">Sem metas</p>}
                  </div>
                </div>

                {/* SDRs */}
                <div className="flex flex-col">
                  <p className="text-xs text-white/50 uppercase tracking-wider mb-2 font-semibold">SDRs</p>
                  <div className="space-y-2 flex-1">
                    {sdrs.map((sdr: any, i: number) => (
                      <GoalBar key={sdr.id} data={sdr} index={i} type="sdr" formatCurrency={formatCurrency} />
                    ))}
                    {sdrs.length === 0 && <p className="text-xs text-white/30">Sem metas</p>}
                  </div>
                </div>
              </div>
            </TVCard>

            {/* Right Side - Propostas + Vendas + Coach */}
            <div className="flex flex-col gap-3">
              {/* Hot Proposals */}
              <TVCard className="flex-1">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-orange-500" />
                    <span className="text-sm font-bold text-white uppercase tracking-wider">Propostas Quentes</span>
                  </div>
                  <span className="text-sm font-bold text-orange-400">{(data?.propostasQuentes || []).length}</span>
                </div>

                <div className="space-y-2 overflow-y-auto max-h-[150px]">
                  {(data?.propostasQuentes || []).slice(0, 5).map((p: any, i: number) => (
                    <motion.div 
                      key={p.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-orange-500/20">
                          {p.calor || 7}
                        </div>
                        <span className="text-sm text-white/80 truncate max-w-[100px]">{p.lead?.name}</span>
                      </div>
                      <span className="text-sm font-bold text-primary">R$ {formatCurrency(p.sale_value || 0)}</span>
                    </motion.div>
                  ))}
                  {(data?.propostasQuentes || []).length === 0 && (
                    <p className="text-sm text-white/30 text-center py-4">Sem propostas quentes</p>
                  )}
                </div>
              </TVCard>

              {/* Monthly Sales */}
              <TVCard className="flex-1">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-emerald-500" />
                    <span className="text-sm font-bold text-white uppercase tracking-wider">Vendas do Mês</span>
                  </div>
                  <span className="text-sm font-bold text-emerald-400">{(data?.vendasDoMes || []).length}</span>
                </div>

                {/* Summary Pills */}
                <div className="flex gap-3 mb-3">
                  <div className="flex-1 text-center py-2 px-3 rounded-lg bg-white/[0.03] border border-white/5">
                    <p className="text-xs text-white/40 mb-0.5">MRR</p>
                    <p className="text-lg font-bold text-primary">R$ {formatCurrency(data?.vendasMRR || 0)}</p>
                  </div>
                  <div className="flex-1 text-center py-2 px-3 rounded-lg bg-white/[0.03] border border-white/5">
                    <p className="text-xs text-white/40 mb-0.5">Projeto</p>
                    <p className="text-lg font-bold text-purple-400">R$ {formatCurrency(data?.vendasProjeto || 0)}</p>
                  </div>
                </div>

                <div className="space-y-1.5 max-h-[100px] overflow-y-auto">
                  {(data?.vendasDoMes || []).slice(0, 5).map((sale: any, i: number) => (
                    <motion.div 
                      key={sale.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10"
                    >
                      <span className="text-sm text-white/70 truncate max-w-[120px]">{sale.leadName}</span>
                      <span className="text-sm font-bold text-emerald-400">R$ {formatCurrency(sale.value)}</span>
                    </motion.div>
                  ))}
                </div>
              </TVCard>

              {/* AI Coach - Smaller */}
              <TVCard accent="purple">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Coach IA</span>
                </div>
                <div className="max-h-[80px] overflow-y-auto">
                  <AICoachSection />
                </div>
              </TVCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Unified TV Card Component
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
        bg-white/[0.03] border border-white/5
        backdrop-blur-sm
        ${accent ? accentClasses[accent] : ""}
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}

// KPI Card - Neutral background, color only on icon/number
function KPICard({ 
  icon: Icon, 
  label, 
  value, 
  prefix = "",
  suffix = "",
  color,
  delta
}: { 
  icon: React.ElementType;
  label: string;
  value: number | string;
  prefix?: string;
  suffix?: string;
  color: string;
  delta?: { value: number; positive: boolean };
}) {
  const colorMap: Record<string, { icon: string; text: string }> = {
    blue: { icon: "text-blue-400", text: "text-blue-400" },
    emerald: { icon: "text-emerald-400", text: "text-emerald-400" },
    amber: { icon: "text-amber-400", text: "text-amber-400" },
    red: { icon: "text-red-400", text: "text-red-400" },
    purple: { icon: "text-purple-400", text: "text-purple-400" },
    primary: { icon: "text-primary", text: "text-primary" },
  };

  const colors = colorMap[color] || colorMap.primary;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -2, backgroundColor: "rgba(255,255,255,0.04)" }}
      className="p-3 rounded-xl bg-white/[0.03] border border-white/5 transition-all cursor-default"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${colors.icon}`} />
        <span className="text-[10px] text-white/40 uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-xl font-bold ${colors.text}`}>
        {prefix}{value}{suffix}
      </p>
      {delta && (
        <div className={`flex items-center gap-0.5 text-[10px] mt-0.5 ${delta.positive ? "text-emerald-400" : "text-red-400"}`}>
          {delta.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          <span>{delta.value}%</span>
        </div>
      )}
    </motion.div>
  );
}

// Individual Goal Bar - Bigger for TV
function GoalBar({ 
  data, 
  index, 
  type,
  formatCurrency 
}: { 
  data: any; 
  index: number; 
  type: "closer" | "sdr";
  formatCurrency: (v: number) => string;
}) {
  const percentage = Math.min(data.percentage || 0, 100);
  const isCompleted = percentage >= 100;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group p-2 rounded-lg hover:bg-white/[0.02] transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <motion.div 
            animate={isCompleted ? { scale: [1, 1.1, 1] } : {}}
            transition={{ repeat: isCompleted ? Infinity : 0, duration: 2 }}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shadow-lg ${
              isCompleted 
                ? "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-emerald-500/30" 
                : "bg-white/10 text-white/60"
            }`}
          >
            {isCompleted ? "✓" : data.name?.charAt(0)}
          </motion.div>
          <div>
            <span className="text-sm font-medium text-white/80 group-hover:text-white transition-colors block">{data.name}</span>
            {type === "closer" && data.current !== undefined && (
              <span className="text-[11px] text-white/40">
                R$ {formatCurrency(data.current || 0)} / R$ {formatCurrency(data.goal || 0)}
              </span>
            )}
            {type === "sdr" && data.current !== undefined && (
              <span className="text-[11px] text-white/40">
                {data.current || 0} / {data.goal || 0} reuniões
              </span>
            )}
          </div>
        </div>
        <span className={`text-lg font-bold ${isCompleted ? "text-emerald-400" : "text-white/80"}`}>
          {percentage.toFixed(0)}%
        </span>
      </div>
      
      <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, delay: index * 0.05, ease: "easeOut" }}
          className={`h-full rounded-full ${
            isCompleted 
              ? "bg-gradient-to-r from-emerald-500 to-emerald-400" 
              : percentage >= 75 
                ? "bg-gradient-to-r from-primary to-yellow-400" 
                : percentage >= 50 
                  ? "bg-gradient-to-r from-amber-600 to-amber-400" 
                  : "bg-white/30"
          }`}
        />
      </div>
    </motion.div>
  );
}
