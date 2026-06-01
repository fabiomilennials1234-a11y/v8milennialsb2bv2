import { useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Users, MapPin, User, Target } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { FunnelChart } from "@/modules/analytics";
import { ORIGIN_COLORS, CHART_TOOLTIP_STYLE, humanizeOrigin } from "./analytics-utils";

interface WhatsappStats {
  total: number;
  abordado: number;
  respondeu: number;
  scheduled: number;
  pending: number;
}

interface PipeWhatsappAnalyticsProps {
  items: any[];
  stats: WhatsappStats;
  responsibleMembers: { id: string; name: string }[];
}

export function PipeWhatsappAnalytics({ items, stats, responsibleMembers }: PipeWhatsappAnalyticsProps) {
  // Funil — usa contagens server-side (precisas, sensíveis ao período)
  const funnelSteps = useMemo(
    () => [
      { label: "Total de Leads", value: stats.total, color: "" },
      { label: "Abordados", value: stats.abordado, color: "" },
      { label: "Respondeu", value: stats.respondeu, color: "" },
      { label: "Agendados", value: stats.scheduled, color: "" },
    ],
    [stats]
  );

  // Conversões entre etapas — também das contagens precisas
  const conversions = useMemo(
    () => [
      { label: "Abordagem", from: stats.total, to: stats.abordado, color: "hsl(var(--chart-2))" },
      { label: "Resposta", from: stats.abordado, to: stats.respondeu, color: "hsl(var(--chart-3))" },
      { label: "Agendamento", from: stats.respondeu, to: stats.scheduled, color: "hsl(var(--success))" },
    ].map((c) => ({ ...c, rate: c.from > 0 ? (c.to / c.from) * 100 : 0 })),
    [stats]
  );

  // Distribuição por origem (subset carregado)
  const originData = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      const key = humanizeOrigin(it.lead?.origin);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [items]);

  // Performance por responsável (subset carregado)
  const responsiblePerf = useMemo(() => {
    return responsibleMembers
      .map((member) => {
        const memberLeads = items.filter(
          (it) => it.responsible_id === member.id || it.sdr_id === member.id
        );
        const scheduled = memberLeads.filter((it) => it.status === "agendado").length;
        return { id: member.id, name: member.name, total: memberLeads.length, scheduled };
      })
      .sort((a, b) => b.total - a.total);
  }, [items, responsibleMembers]);

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        {/* Funil de Qualificação */}
        <div className="glass-card p-6">
          <h3 className="font-semibold mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Funil de Qualificação
          </h3>
          <FunnelChart title="Pipeline" steps={funnelSteps} />
        </div>

        {/* Taxa de Conversão por etapa */}
        <div className="glass-card p-6">
          <h3 className="font-semibold mb-6 flex items-center gap-2">
            <Target className="w-5 h-5 text-success" />
            Taxa de Conversão
          </h3>
          <div className="space-y-5">
            {conversions.map((c, i) => (
              <motion.div
                key={c.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <div className="flex items-center justify-between mb-1.5 text-sm">
                  <span className="text-muted-foreground">{c.label}</span>
                  <span className="font-semibold tabular-nums" style={{ color: c.color }}>
                    {c.rate.toFixed(0)}%
                    <span className="text-xs text-muted-foreground font-normal ml-1.5">
                      ({c.to}/{c.from})
                    </span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: c.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(c.rate, 100)}%` }}
                    transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Leads por Origem */}
        <div className="glass-card p-6">
          <h3 className="font-semibold mb-6 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Leads por Origem
          </h3>
          {originData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <MapPin className="w-12 h-12 mb-4 opacity-20" />
              <p>Nenhum lead no período</p>
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={originData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {originData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={ORIGIN_COLORS[index % ORIGIN_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(value: number, name: string) => [`${value} leads`, name]}
                  />
                  <Legend formatter={(value) => <span className="text-sm">{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Performance por Responsável */}
        <div className="glass-card p-6">
          <h3 className="font-semibold mb-6 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Performance por Responsável
          </h3>
          <div className="space-y-4">
            {responsiblePerf.map((member) => (
              <div key={member.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.total} leads</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-primary">{member.scheduled}</p>
                  <p className="text-xs text-muted-foreground">agendados</p>
                </div>
              </div>
            ))}

            {responsiblePerf.length === 0 && (
              <p className="text-center text-muted-foreground py-4">Nenhum responsável cadastrado</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
