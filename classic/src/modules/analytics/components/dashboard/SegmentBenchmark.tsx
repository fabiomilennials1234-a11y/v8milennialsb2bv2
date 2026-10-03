import { memo } from "react";
import { motion } from "framer-motion";
import { useSegmentBenchmark } from "@/modules/analytics/hooks/useSegmentBenchmark";
import { useDashboardMetrics } from "@/modules/analytics/hooks/useDashboardMetrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Info } from "lucide-react";

interface Props { month: number; year: number }

function SegmentBenchmarkBase({ month, year }: Props) {
  const { data: benchmark, isLoading: benchLoading } = useSegmentBenchmark();
  const { data: metrics } = useDashboardMetrics(month, year, null);

  if (benchLoading) return <Card><CardContent className="p-6"><Skeleton className="h-32" /></CardContent></Card>;

  if (!benchmark?.available) {
    const msg = benchmark?.reason === "no_segment_data"
      ? "Configure o segmento dos seus leads para habilitar comparativos."
      : "Dados comparativos disponíveis quando houver mais operações no seu segmento.";
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Info className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{msg}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const orgTicket = metrics?.ticketMedio || 0;
  const orgConversion = metrics?.totalLeads && metrics.totalLeads > 0
    ? ((metrics.novosClientes || 0) / metrics.totalLeads) * 100 : 0;
  const orgLeadsPerSeller = 0; // Would need team size - simplified

  const comparisons = [
    { label: "Ticket Médio", org: orgTicket, avg: benchmark.avgTicketMedio || 0, format: "currency" as const },
    { label: "Taxa de Conversão", org: orgConversion, avg: benchmark.avgConversionRate || 0, format: "percent" as const },
  ];

  const fmt = (v: number, f: string) => f === "currency" ? (v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}K` : `R$ ${Math.round(v)}`) : `${v.toFixed(1)}%`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Comparativo do Segmento
          <span className="text-xs text-muted-foreground font-normal ml-1">
            ({benchmark.segment} — {benchmark.peerCount} operações)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {comparisons.map((c, i) => {
            const maxVal = Math.max(c.org, c.avg, 1);
            const isAbove = c.org >= c.avg;
            return (
              <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                <p className="text-sm font-medium mb-3">{c.label}</p>
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-primary font-medium">Sua operação</span>
                      <span className="font-bold">{fmt(c.org, c.format)}</span>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${(c.org / maxVal) * 100}%` }} transition={{ duration: 0.6 }} className="h-full rounded-full bg-primary" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Média do segmento</span>
                      <span className="font-medium">{fmt(c.avg, c.format)}</span>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${(c.avg / maxVal) * 100}%` }} transition={{ duration: 0.6, delay: 0.1 }} className="h-full rounded-full bg-muted-foreground/30" />
                    </div>
                  </div>
                  <p className={`text-xs font-medium ${isAbove ? "text-success" : "text-destructive"}`}>
                    {isAbove ? "↑ Acima da média" : "↓ Abaixo da média"}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export const SegmentBenchmark = memo(SegmentBenchmarkBase);
