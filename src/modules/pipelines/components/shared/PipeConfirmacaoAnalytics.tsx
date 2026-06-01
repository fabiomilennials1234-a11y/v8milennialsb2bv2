import { useMemo } from "react";
import { TrendingUp, MapPin, Users, User, CheckCircle2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { FunnelChart } from "@/modules/analytics";
import { ConfirmacaoStats } from "../legacy/confirmacao";
import { ORIGIN_COLORS, CHART_TOOLTIP_STYLE, humanizeOrigin } from "./analytics-utils";

interface PipeConfirmacaoAnalyticsProps {
  items: any[];
  responsibleMembers: { id: string; name: string }[];
}

export function PipeConfirmacaoAnalytics({ items, responsibleMembers }: PipeConfirmacaoAnalyticsProps) {
  // Funil de comparecimento — contagens sobre os itens do período
  const funnelSteps = useMemo(() => {
    const total = items.length;
    const confirmadas = items.filter(
      (it) => it.is_confirmed === true || it.status === "compareceu"
    ).length;
    const compareceram = items.filter((it) => it.status === "compareceu").length;
    return [
      { label: "Reuniões Marcadas", value: total, color: "" },
      { label: "Confirmadas", value: confirmadas, color: "" },
      { label: "Compareceram", value: compareceram, color: "" },
    ];
  }, [items]);

  // Distribuição por origem
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

  // Performance por responsável — reuniões e comparecimentos
  const responsiblePerf = useMemo(() => {
    return responsibleMembers
      .map((member) => {
        const memberItems = items.filter(
          (it) =>
            it.responsible_id === member.id ||
            it.sdr_id === member.id ||
            it.closer_id === member.id
        );
        const compareceu = memberItems.filter((it) => it.status === "compareceu").length;
        const rate = memberItems.length > 0 ? (compareceu / memberItems.length) * 100 : 0;
        return { id: member.id, name: member.name, total: memberItems.length, compareceu, rate };
      })
      .sort((a, b) => b.total - a.total);
  }, [items, responsibleMembers]);

  return (
    <div className="space-y-6">
      {/* Informações (cards de stats) */}
      <ConfirmacaoStats data={items} />

      {/* Gráficos */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Funil de Comparecimento */}
        <div className="glass-card p-6">
          <h3 className="font-semibold mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Funil de Comparecimento
          </h3>
          <FunnelChart title="Reuniões" steps={funnelSteps} />
        </div>

        {/* Reuniões por Origem */}
        <div className="glass-card p-6">
          <h3 className="font-semibold mb-6 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Reuniões por Origem
          </h3>
          {originData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <MapPin className="w-12 h-12 mb-4 opacity-20" />
              <p>Nenhuma reunião no período</p>
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
                    formatter={(value: number, name: string) => [`${value} reuniões`, name]}
                  />
                  <Legend formatter={(value) => <span className="text-sm">{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Performance por Responsável */}
        <div className="glass-card p-6 md:col-span-2">
          <h3 className="font-semibold mb-6 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Performance por Responsável
          </h3>
          <div className="grid sm:grid-cols-2 gap-4">
            {responsiblePerf.map((member) => (
              <div key={member.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.total} reuniões</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-success flex items-center gap-1 justify-end">
                    <CheckCircle2 className="w-4 h-4" />
                    {member.compareceu}
                  </p>
                  <p className="text-xs text-muted-foreground">{member.rate.toFixed(0)}% comparecimento</p>
                </div>
              </div>
            ))}

            {responsiblePerf.length === 0 && (
              <p className="text-center text-muted-foreground py-4 sm:col-span-2">
                Nenhum responsável cadastrado
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
