import { Calendar, DollarSign, Fuel, MessageSquare } from "lucide-react";
import { KpiTile, ValueUnit } from "@/components/ui/bento";
import type { OutboundMetrics } from "@/modules/analytics/hooks/useOutboundMetrics";

interface Props {
  metrics: OutboundMetrics;
}

/** Variação mês contra mês. Sem base no mês anterior não há delta — mostra nota. */
function variacao(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return Math.round(((current - previous) / previous) * 100);
}

const cards = [
  { key: "leadsRecebidos" as const, prevKey: "leadsRecebidosPrev" as const, label: "Leads Recebidos", icon: Fuel, suffix: "", tone: "info" as const },
  { key: "taxaResposta" as const, prevKey: "taxaRespostaPrev" as const, label: "Taxa de Resposta", icon: MessageSquare, suffix: "%", tone: "neutral" as const },
  { key: "reunioesAgendadas" as const, prevKey: "reunioesAgendadasPrev" as const, label: "Reuniões Agendadas", icon: Calendar, suffix: "", tone: "gold" as const },
  { key: "vendasFechadas" as const, prevKey: "vendasFechadasPrev" as const, label: "Vendas Fechadas", icon: DollarSign, suffix: "", tone: "good" as const },
];

export function OutboundMetricCards({ metrics }: Props) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(({ key, prevKey, label, icon, suffix, tone }) => {
        const delta = variacao(metrics[key], metrics[prevKey]);
        return (
          <KpiTile
            key={key}
            label={label}
            icon={icon}
            tone={tone}
            value={
              <>
                {metrics[key].toLocaleString("pt-BR")}
                {suffix && <ValueUnit>{suffix}</ValueUnit>}
              </>
            }
            delta={delta}
            deltaLabel={delta !== undefined ? "vs. mês anterior" : undefined}
            note={delta === undefined ? "Sem base no mês anterior" : undefined}
          />
        );
      })}
    </div>
  );
}
