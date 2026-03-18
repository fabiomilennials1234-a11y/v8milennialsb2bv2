import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { type TeamResponseTimeRow } from "@/hooks/useAnalyticsEngajamento";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { formatResponseTime } from "./EngagementKPIs";

interface Props {
  data: TeamResponseTimeRow[];
}

// Color bands: green <4min (240s), orange 4-7min (240-420s), red >7min
function bandColor(seconds: number): {
  bar: string;
  badge: string;
  label: string;
} {
  if (seconds <= 0) return { bar: "bg-muted", badge: "text-muted-foreground", label: "sem dados" };
  if (seconds <= 240) return { bar: "bg-green-500", badge: "text-green-600 dark:text-green-400", label: "excelente" };
  if (seconds <= 420) return { bar: "bg-yellow-500", badge: "text-yellow-600 dark:text-yellow-400", label: "atenção" };
  return { bar: "bg-destructive", badge: "text-destructive", label: "lento" };
}

export function TeamResponseTimes({ data }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" />
            Tempo de Resposta por Membro
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de time disponíveis"
            detail="Nenhum membro da equipe encontrado para o período."
          />
        </CardContent>
      </Card>
    );
  }

  const sorted = [...data].sort((a, b) => {
    // Sort: copilot first, then by response time ascending (0 = no data, goes last)
    if (a.is_copilot && !b.is_copilot) return -1;
    if (!a.is_copilot && b.is_copilot) return 1;
    if (a.avg_response_seconds === 0) return 1;
    if (b.avg_response_seconds === 0) return -1;
    return a.avg_response_seconds - b.avg_response_seconds;
  });

  const maxSeconds = Math.max(...sorted.map((r) => r.avg_response_seconds), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="h-4 w-4" />
          Tempo de Resposta por Membro
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Tempo médio entre mensagem recebida e primeira resposta
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.map((row) => {
          const { bar, badge, label } = bandColor(row.avg_response_seconds);
          const pct =
            row.avg_response_seconds > 0
              ? Math.max((row.avg_response_seconds / maxSeconds) * 100, 4)
              : 0;

          return (
            <div key={row.member_id} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-medium truncate">
                    {row.is_copilot ? "🤖 Copilot" : row.member_name}
                  </span>
                  <span className={`text-[10px] ${badge}`}>({label})</span>
                </div>
                <span className={`tabular-nums font-semibold shrink-0 ml-2 ${badge}`}>
                  {row.avg_response_seconds > 0
                    ? formatResponseTime(row.avg_response_seconds)
                    : "—"}
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${bar}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}

        {/* Legend */}
        <div className="flex items-center gap-3 pt-2 border-t border-border flex-wrap">
          <span className="text-[10px] text-muted-foreground">Faixas:</span>
          {[
            { label: "<4min", cls: "bg-green-500" },
            { label: "4-7min", cls: "bg-yellow-500" },
            { label: ">7min", cls: "bg-destructive" },
          ].map(({ label, cls }) => (
            <div key={label} className="flex items-center gap-1">
              <div className={`w-2.5 h-2.5 rounded-sm ${cls}`} />
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
