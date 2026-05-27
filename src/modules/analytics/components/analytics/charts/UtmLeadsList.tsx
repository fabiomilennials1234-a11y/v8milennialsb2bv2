import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, ExternalLink } from "lucide-react";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";
import type { UtmLeadRow } from "@/modules/analytics/hooks/useAnalyticsUtms";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  leads: UtmLeadRow[];
  onOpenLead: (leadId: string) => void;
}

export function UtmLeadsList({ leads, onOpenLead }: Props) {
  if (leads.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={AT.chartTitle}>Leads</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Nenhum lead encontrado."
            detail="Não há leads com esta combinação de UTMs no período."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={AT.chartTitle}>
          Leads ({leads.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Nome</th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Email</th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Telefone</th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Entrada</th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Status</th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Responsável</th>
                <th className="text-center font-medium text-muted-foreground py-2 px-2">Rating</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b border-border/40 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-2 px-2">
                    <button
                      onClick={() => onOpenLead(lead.id)}
                      className="font-medium text-primary hover:underline underline-offset-2 inline-flex items-center gap-1"
                    >
                      {lead.name}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">{lead.email || "—"}</td>
                  <td className="py-2 px-2 text-muted-foreground">{lead.phone || "—"}</td>
                  <td className="py-2 px-2 text-muted-foreground tabular-nums">
                    {format(new Date(lead.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                  </td>
                  <td className="py-2 px-2">
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                      {lead.pipe_status}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">{lead.responsible}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3 w-3 ${
                            i < lead.rating
                              ? "fill-yellow-400 text-yellow-400"
                              : "text-muted-foreground/30"
                          }`}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
