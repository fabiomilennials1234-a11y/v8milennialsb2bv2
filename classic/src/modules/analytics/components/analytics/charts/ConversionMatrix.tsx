import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Grid3X3 } from "lucide-react";
import { type MemberStat } from "@/modules/analytics/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  members: MemberStat[];
  totalLeads: number;
}

function pct(num: number, den: number): string {
  if (den === 0) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

function cellColor(value: number, avg: number): string {
  if (value === 0) return "";
  if (value >= avg * 1.1) return "bg-success/10 text-success font-semibold";
  if (value <= avg * 0.9) return "bg-destructive/10 text-destructive";
  return "text-muted-foreground";
}

export function ConversionMatrix({ members, totalLeads }: Props) {
  if (members.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className={AT.chartTitle}>Matriz de Conversão</CardTitle></CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados de vendedores no período." />
        </CardContent>
      </Card>
    );
  }

  const avgLeadsToMeetings = members.reduce((s, m) => s + (m.leads_handled > 0 ? m.meetings_attended / m.leads_handled : 0), 0) / members.length;
  const avgMeetingsToProposals = members.reduce((s, m) => s + (m.meetings_attended > 0 ? m.proposals_total / m.meetings_attended : 0), 0) / members.length;
  const avgProposalsToWon = members.reduce((s, m) => s + (m.proposals_total > 0 ? m.deals_won / m.proposals_total : 0), 0) / members.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Grid3X3 className="h-4 w-4" />
          Matriz de Conversão — Vendedor × Etapa
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Vendedor</th>
                <th className="text-center py-2 px-3 font-medium text-muted-foreground">Lead→Reunião</th>
                <th className="text-center py-2 px-3 font-medium text-muted-foreground">Reunião→Prop</th>
                <th className="text-center py-2 px-3 font-medium text-muted-foreground">Prop→Venda</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const lToM = m.leads_handled > 0 ? m.meetings_attended / m.leads_handled : 0;
                const mToP = m.meetings_attended > 0 ? m.proposals_total / m.meetings_attended : 0;
                const pToW = m.proposals_total > 0 ? m.deals_won / m.proposals_total : 0;
                return (
                  <tr key={m.member_id} className="border-b border-border/50">
                    <td className="py-2 pr-4">{m.member_name}</td>
                    <td className={`text-center py-2 px-3 rounded ${cellColor(lToM, avgLeadsToMeetings)}`}>
                      {pct(m.meetings_attended, m.leads_handled)}
                    </td>
                    <td className={`text-center py-2 px-3 rounded ${cellColor(mToP, avgMeetingsToProposals)}`}>
                      {pct(m.proposals_total, m.meetings_attended)}
                    </td>
                    <td className={`text-center py-2 px-3 rounded ${cellColor(pToW, avgProposalsToWon)}`}>
                      {pct(m.deals_won, m.proposals_total)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-border">
                <td className="py-2 pr-4 text-muted-foreground italic">Média</td>
                <td className="text-center py-2 px-3 text-muted-foreground">{Math.round(avgLeadsToMeetings * 100)}%</td>
                <td className="text-center py-2 px-3 text-muted-foreground">{Math.round(avgMeetingsToProposals * 100)}%</td>
                <td className="text-center py-2 px-3 text-muted-foreground">{Math.round(avgProposalsToWon * 100)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
