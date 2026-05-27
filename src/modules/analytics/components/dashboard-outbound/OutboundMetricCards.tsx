import { Fuel, MessageSquare, Calendar, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { OutboundMetrics } from "@/modules/analytics/hooks/useOutboundMetrics";

interface Props {
  metrics: OutboundMetrics;
}

function Trend({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  const isUp = diff >= 0;
  return (
    <span className={`flex items-center gap-1 text-xs ${isUp ? "text-green-500" : "text-red-500"}`}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isUp ? "+" : ""}{pct}%
    </span>
  );
}

const cards = [
  { key: "leadsRecebidos" as const, prevKey: "leadsRecebidosPrev" as const, label: "Leads Recebidos", icon: Fuel, suffix: "" },
  { key: "taxaResposta" as const, prevKey: "taxaRespostaPrev" as const, label: "Taxa de Resposta", icon: MessageSquare, suffix: "%" },
  { key: "reunioesAgendadas" as const, prevKey: "reunioesAgendadasPrev" as const, label: "Reuniões Agendadas", icon: Calendar, suffix: "" },
  { key: "vendasFechadas" as const, prevKey: "vendasFechadasPrev" as const, label: "Vendas Fechadas", icon: DollarSign, suffix: "" },
];

export function OutboundMetricCards({ metrics }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ key, prevKey, label, icon: Icon, suffix }) => (
        <Card key={key}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <Icon className="w-5 h-5 text-muted-foreground" />
              <Trend current={metrics[key]} previous={metrics[prevKey]} />
            </div>
            <p className="text-2xl font-bold">{metrics[key]}{suffix}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
