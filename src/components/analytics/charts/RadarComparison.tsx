import { useState } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { type MemberStat } from "@/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  members: MemberStat[];
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
];

function normalize(value: number, max: number): number {
  if (max === 0) return 0;
  return Math.round((value / max) * 100);
}

export function RadarComparison({ members }: Props) {
  const [selected, setSelected] = useState<string[]>(
    members.slice(0, 2).map((m) => m.member_id),
  );

  if (members.length < 2) {
    return (
      <Card>
        <CardHeader><CardTitle className={AT.chartTitle}>Perfil Comparativo</CardTitle></CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Necessário pelo menos 2 vendedores." />
        </CardContent>
      </Card>
    );
  }

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 4
          ? [...prev, id]
          : prev,
    );
  };

  const maxes = {
    volume: Math.max(...members.map((m) => m.leads_handled)),
    conversion: Math.max(...members.map((m) => (m.leads_handled > 0 ? m.deals_won / m.leads_handled : 0))),
    ticket: Math.max(...members.map((m) => m.avg_ticket)),
    velocity: Math.max(...members.map((m) => m.deals_won)),
    meetings: Math.max(...members.map((m) => m.meetings_attended)),
    proposals: Math.max(...members.map((m) => m.proposals_total)),
  };

  const radarData = [
    { axis: "Volume", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      return [id, normalize(m.leads_handled, maxes.volume)];
    }))},
    { axis: "Conversão", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      const rate = m.leads_handled > 0 ? m.deals_won / m.leads_handled : 0;
      return [id, normalize(rate, maxes.conversion)];
    }))},
    { axis: "Ticket", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      return [id, normalize(m.avg_ticket, maxes.ticket)];
    }))},
    // Note: spec calls for Velocidade/Retenção/Resposta dimensions, but those require
    // data from Phases 2-3. Using Vendas/Reuniões/Propostas as Phase 1 proxy.
    { axis: "Vendas", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      return [id, normalize(m.deals_won, maxes.velocity)];
    }))},
    { axis: "Reuniões", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      return [id, normalize(m.meetings_attended, maxes.meetings)];
    }))},
    { axis: "Propostas", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      return [id, normalize(m.proposals_total, maxes.proposals)];
    }))},
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Users className="h-4 w-4" />
            Perfil Comparativo
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            {members.map((m) => (
              <Badge
                key={m.member_id}
                variant={selected.includes(m.member_id) ? "default" : "outline"}
                className="cursor-pointer text-xs"
                style={selected.includes(m.member_id) ? { backgroundColor: COLORS[selected.indexOf(m.member_id)] } : {}}
                onClick={() => toggle(m.member_id)}
              >
                {m.member_name.split(" ")[0]}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart data={radarData}>
            <PolarGrid className="stroke-border" />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <PolarRadiusAxis tick={false} domain={[0, 100]} />
            {selected.map((id, i) => (
              <Radar
                key={id}
                dataKey={id}
                name={members.find((m) => m.member_id === id)?.member_name.split(" ")[0] ?? ""}
                stroke={COLORS[i]}
                fill={COLORS[i]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: "11px" }} />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
