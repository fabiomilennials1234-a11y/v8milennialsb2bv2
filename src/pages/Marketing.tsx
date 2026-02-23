import { useState } from "react";
import {
  BarChart2,
  DollarSign,
  Users,
  Calendar,
  Target,
  Trophy,
  TrendingUp,
  Percent,
  Loader2,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motion } from "framer-motion";
import { useMktByOrigin } from "@/hooks/useMktByOrigin";
import { useMktOriginConfigs } from "@/hooks/useMktOriginConfig";
import { MktOriginCard } from "@/components/marketing/MktOriginCard";
import { MktConfigModal } from "@/components/marketing/MktConfigModal";
import { useIsAdmin } from "@/hooks/useUserRole";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const YEARS = [2024, 2025, 2026, 2027];

interface SummaryCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle?: string;
  index: number;
}

function SummaryCard({ icon: Icon, label, value, subtitle, index }: SummaryCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className="glass-card rounded-xl p-4 flex flex-col gap-1"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-foreground">{value}</p>
      {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
    </motion.div>
  );
}

export default function Marketing() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 0 = Geral
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [configOpen, setConfigOpen] = useState(false);

  const isGeral = selectedMonth === 0;
  const { byOrigin, summary, isLoading } = useMktByOrigin(selectedMonth, selectedYear);
  const { configMap } = useMktOriginConfigs(selectedMonth, selectedYear);
  const { isAdmin } = useIsAdmin();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-primary" />
            Marketing
          </h1>
          <p className="text-muted-foreground text-sm">
            Indicadores por origem de lead — investimento, custo e conversão.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select
            value={selectedMonth.toString()}
            onValueChange={(v) => setSelectedMonth(Number(v))}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Geral</SelectItem>
              {MONTHS.map((label, i) => (
                <SelectItem key={i} value={(i + 1).toString()}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isGeral && (
            <Select
              value={selectedYear.toString()}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="w-[90px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isAdmin && !isGeral && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => setConfigOpen(true)}
              title="Configurar investimentos e métricas"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Summary cards (8 metrics) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
            <SummaryCard
              icon={DollarSign}
              label="Investimento total"
              value={formatCurrency(summary.totalInvestimentoReais)}
              index={0}
            />
            <SummaryCard
              icon={Users}
              label="Total de leads"
              value={summary.totalLeads.toLocaleString("pt-BR")}
              index={1}
            />
            <SummaryCard
              icon={DollarSign}
              label="Custo por lead"
              value={formatCurrency(summary.totalCustoPorLead)}
              index={2}
            />
            <SummaryCard
              icon={Calendar}
              label="Agendamentos"
              value={summary.totalAgendamentos.toLocaleString("pt-BR")}
              index={3}
            />
            <SummaryCard
              icon={Target}
              label="Comparecimentos"
              value={summary.totalComparecimentos.toLocaleString("pt-BR")}
              index={4}
            />
            <SummaryCard
              icon={Trophy}
              label="Vendas"
              value={summary.totalVendas.toLocaleString("pt-BR")}
              index={5}
            />
            <SummaryCard
              icon={TrendingUp}
              label="Custo por venda"
              value={formatCurrency(summary.totalCustoPorVenda)}
              index={6}
            />
            <SummaryCard
              icon={Percent}
              label="Conversão geral"
              value={`${summary.totalConversionRate.toFixed(1)}%`}
              subtitle="leads → vendas"
              index={7}
            />
          </div>

          {/* Origin cards grid */}
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Desempenho por origem
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {byOrigin.map((metrics, i) => (
                <MktOriginCard
                  key={metrics.origin}
                  metrics={metrics}
                  config={configMap[metrics.origin]}
                  index={i}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Config Modal */}
      <MktConfigModal
        open={configOpen}
        onOpenChange={setConfigOpen}
        month={selectedMonth}
        year={selectedYear}
        configMap={configMap}
      />
    </div>
  );
}
