import { Users, TrendingUp, Calendar, AlertTriangle, Heart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePortfolioHealth } from "@/hooks/usePortfolioHealth";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

function healthColor(score: number) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-red-400";
}

function healthLabel(score: number) {
  if (score >= 80) return "Saudável";
  if (score >= 60) return "Atenção";
  return "Crítico";
}

function healthBadgeVariant(score: number): "default" | "secondary" | "destructive" | "outline" {
  if (score >= 80) return "default";
  if (score >= 60) return "secondary";
  return "destructive";
}

interface KPICardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  className?: string;
}

function KPICard({ label, value, sub, icon, className }: KPICardProps) {
  return (
    <Card className={cn("bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors", className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider truncate">
              {label}
            </span>
            <span className="text-2xl font-semibold text-white tabular-nums leading-tight">
              {value}
            </span>
            {sub && <span className="text-xs text-zinc-500 mt-0.5">{sub}</span>}
          </div>
          <div className="shrink-0 mt-0.5 text-zinc-600">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CarteiraKPIs() {
  const { data, isLoading } = usePortfolioHealth();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="space-y-2 animate-pulse">
                <div className="h-3 bg-zinc-800 rounded w-2/3" />
                <div className="h-7 bg-zinc-800 rounded w-1/2" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Clientes Ativos", icon: <Users size={18} /> },
          { label: "Receita Recorrente", icon: <TrendingUp size={18} /> },
          { label: "Pedidos Esperados", icon: <Calendar size={18} /> },
          { label: "Recompra Atrasada", icon: <AlertTriangle size={18} /> },
          { label: "Health Médio", icon: <Heart size={18} /> },
        ].map(({ label, icon }) => (
          <KPICard key={label} label={label} value="—" icon={icon} />
        ))}
      </div>
    );
  }

  const { totalClients, totalRecurring, expectedThisWeek, overdueCount, avgHealth } = data;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <KPICard
        label="Clientes Ativos"
        value={totalClients}
        sub="na carteira"
        icon={<Users size={18} />}
      />

      <KPICard
        label="Receita Recorrente"
        value={formatBRL(totalRecurring)}
        sub="ticket médio mensal"
        icon={<TrendingUp size={18} />}
      />

      <KPICard
        label="Pedidos Esperados"
        value={expectedThisWeek}
        sub="próximos 7 dias"
        icon={<Calendar size={18} />}
      />

      <KPICard
        label="Recompra Atrasada"
        value={
          <span className="flex items-center gap-2">
            <span className={overdueCount > 0 ? "text-red-400" : "text-white"}>{overdueCount}</span>
            {overdueCount > 0 && (
              <Badge variant="destructive" className="text-xs px-1.5 py-0 h-5">
                Risco
              </Badge>
            )}
          </span>
        }
        sub={overdueCount > 0 ? "clientes em atraso" : "tudo em dia"}
        icon={<AlertTriangle size={18} className={overdueCount > 0 ? "text-red-500" : ""} />}
      />

      <KPICard
        label="Health Médio"
        value={
          <span className={cn("flex items-center gap-2", healthColor(avgHealth))}>
            {avgHealth}
            <Badge
              variant={healthBadgeVariant(avgHealth)}
              className={cn(
                "text-xs px-1.5 py-0 h-5",
                avgHealth >= 80 && "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
                avgHealth >= 60 && avgHealth < 80 && "bg-amber-500/20 text-amber-400 border-amber-500/30",
                avgHealth < 60 && "bg-red-500/20 text-red-400 border-red-500/30",
              )}
            >
              {healthLabel(avgHealth)}
            </Badge>
          </span>
        }
        sub="score 0–100"
        icon={<Heart size={18} className={healthColor(avgHealth)} />}
      />
    </div>
  );
}
