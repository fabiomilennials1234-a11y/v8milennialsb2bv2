import { AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type PipelineAgingStage } from "@/hooks/useAnalyticsPipesFunis";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  stages: PipelineAgingStage[];
}

const STAGE_LABELS: Record<string, string> = {
  // whatsapp
  novo: "Novo",
  abordado: "Abordado",
  respondeu: "Respondeu",
  // confirmacao
  reuniao_marcada: "Reunião Marcada",
  confirmar_d5: "Confirmar D-5",
  confirmar_d3: "Confirmar D-3",
  confirmar_d2: "Confirmar D-2",
  confirmar_d1: "Confirmar D-1",
  confirmacao_no_dia: "Conf. no Dia",
  remarcar: "Remarcar",
  // propostas
  marcar_compromisso: "Marcar Compromisso",
  reativar: "Reativar",
  compromisso_marcado: "Compromisso Marcado",
  proposta_enviada: "Proposta Enviada",
  esfriou: "Esfriou",
  futuro: "Futuro",
};

interface SegmentProps {
  count: number;
  total: number;
  color: string;
  label: string;
}

function Segment({ count, total, color, label }: SegmentProps) {
  if (count === 0) return null;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div
      title={`${label}: ${count} (${pct}%)`}
      className="h-full flex items-center justify-center transition-all duration-300 text-white text-xs font-medium overflow-hidden"
      style={{ width: `${pct}%`, backgroundColor: color, minWidth: count > 0 ? "1px" : "0px" }}
    >
      {pct > 10 ? `${count}` : ""}
    </div>
  );
}

export function PipelineAging({ stages }: Props) {
  if (!stages || stages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Envelhecimento do Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Nenhum lead ativo no pipeline"
            detail="Leads ativos aparecerão aqui com indicadores de tempo em cada etapa."
          />
        </CardContent>
      </Card>
    );
  }

  // Alert if any stage has >50% in risk/critical
  const dangerStages = stages.filter((s) => {
    const riskPct =
      s.total > 0 ? ((s.risk_count + s.critical_count) / s.total) * 100 : 0;
    return riskPct > 50;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Envelhecimento do Pipeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> Saudável (&lt;3d)
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-orange-400 inline-block" /> Atenção (3–7d)
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Risco (7–14d)
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-red-900 inline-block" /> Crítico (&gt;14d)
          </div>
        </div>

        {/* Alert */}
        {dangerStages.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {dangerStages.length === 1
                ? `Etapa "${STAGE_LABELS[dangerStages[0].stage_name] ?? dangerStages[0].stage_name}" tem mais de 50% dos leads em risco ou crítico.`
                : `${dangerStages.length} etapas têm mais de 50% dos leads em risco ou crítico.`}
            </span>
          </div>
        )}

        {/* Bars */}
        <div className="space-y-3">
          {stages.map((stage) => {
            const label = STAGE_LABELS[stage.stage_name] ?? stage.stage_name;
            return (
              <div key={stage.stage_name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium">{label}</span>
                  <span className="text-muted-foreground">{stage.total} leads</span>
                </div>
                <div className="h-6 rounded overflow-hidden flex bg-muted">
                  <Segment
                    count={stage.healthy_count}
                    total={stage.total}
                    color="#22c55e"
                    label="Saudável"
                  />
                  <Segment
                    count={stage.attention_count}
                    total={stage.total}
                    color="#fb923c"
                    label="Atenção"
                  />
                  <Segment
                    count={stage.risk_count}
                    total={stage.total}
                    color="#ef4444"
                    label="Risco"
                  />
                  <Segment
                    count={stage.critical_count}
                    total={stage.total}
                    color="#7f1d1d"
                    label="Crítico"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
