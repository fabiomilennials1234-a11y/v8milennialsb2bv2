import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type PipelineAgingStage } from "@/hooks/useAnalyticsPipesFunis";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

// WeeklyPipelineFlow shows a summary table of pipeline stage totals.
// Without a weekly breakdown RPC, we derive week-like buckets from the aging data
// using the health/attention/risk/critical buckets as a proxy for recency.

interface Props {
  stages: PipelineAgingStage[];
}

const STAGE_LABELS: Record<string, string> = {
  novo: "Novo",
  abordado: "Abordado",
  respondeu: "Respondeu",
  reuniao_marcada: "Reunião Marcada",
  confirmar_d5: "Conf. D-5",
  confirmar_d3: "Conf. D-3",
  confirmar_d1: "Conf. D-1",
  confirmacao_no_dia: "Conf. Dia",
  remarcar: "Remarcar",
  marcar_compromisso: "Marcar Comp.",
  reativar: "Reativar",
  compromisso_marcado: "Comp. Marcado",
  proposta_enviada: "Prop. Enviada",
  esfriou: "Esfriou",
  futuro: "Futuro",
};

// Use aging buckets as weekly proxies:
// healthy_count ~ this week, attention_count ~ last week, risk_count ~ 2w ago, critical_count ~ 3w+ ago
const BUCKETS = [
  { key: "healthy_count" as const, label: "Esta semana", positiveClass: "text-green-600 dark:text-green-400 font-semibold" },
  { key: "attention_count" as const, label: "Semana passada", positiveClass: "text-orange-500 font-semibold" },
  { key: "risk_count" as const, label: "2 semanas atrás", positiveClass: "text-red-500 font-semibold" },
  { key: "critical_count" as const, label: "3+ semanas", positiveClass: "text-red-900 dark:text-red-400 font-semibold" },
];

function netClass(value: number): string {
  if (value > 0) return "text-green-600 dark:text-green-400 font-semibold";
  if (value < 0) return "text-destructive font-semibold";
  return "text-muted-foreground";
}

export function WeeklyPipelineFlow({ stages }: Props) {
  if (!stages || stages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Fluxo Semanal do Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Nenhum lead ativo no pipeline"
            detail="Leads ativos mostrarão a distribuição semanal por etapa."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Fluxo Semanal do Pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 font-medium">Etapa</th>
                {BUCKETS.map((b) => (
                  <th key={b.key} className="text-center py-2 font-medium whitespace-nowrap">
                    {b.label}
                  </th>
                ))}
                <th className="text-center py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stages.map((stage) => {
                const label = STAGE_LABELS[stage.stage_name] ?? stage.stage_name;
                return (
                  <tr key={stage.stage_name} className="hover:bg-muted/40 transition-colors">
                    <td className="py-2 font-medium">{label}</td>
                    {BUCKETS.map((b) => {
                      const val = stage[b.key];
                      return (
                        <td key={b.key} className="py-2 text-center">
                          <span className={val > 0 ? b.positiveClass : "text-muted-foreground"}>
                            {val > 0 ? `+${val}` : val === 0 ? "—" : val}
                          </span>
                        </td>
                      );
                    })}
                    <td className="py-2 text-center">
                      <span className={netClass(stage.total)}>
                        {stage.total}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold text-muted-foreground">
                <td className="py-2">Total</td>
                {BUCKETS.map((b) => {
                  const sum = stages.reduce((acc, s) => acc + s[b.key], 0);
                  return (
                    <td key={b.key} className="py-2 text-center">
                      {sum > 0 ? `+${sum}` : sum === 0 ? "—" : sum}
                    </td>
                  );
                })}
                <td className="py-2 text-center font-bold text-foreground">
                  {stages.reduce((acc, s) => acc + s.total, 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Distribuição baseada no tempo desde a última atualização de cada lead.
        </p>
      </CardContent>
    </Card>
  );
}
