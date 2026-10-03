import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { type OriginQuality } from "@/modules/analytics/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  origins: OriginQuality[];
}

const ORIGIN_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  instagram: "Instagram",
  tiktok: "Tiktok",
  google_ads: "Google Ads",
  site: "Site",
  landing_page: "Landing Page",
  remarketing: "Remarketing",
  indicacao: "Indicação",
  evento: "Evento",
  prospeccao_ativa: "Prospecção Ativa",
  cal: "Calendário",
  outro: "Outro",
};

function qualityScore(o: OriginQuality): number {
  const maxConv = 50;
  const maxTicket = 100000;
  const maxVol = 500;
  const convScore = Math.min(o.conversion_rate / maxConv, 1) * 4;
  const ticketScore = Math.min(o.avg_ticket / maxTicket, 1) * 3;
  const volScore = Math.min(o.lead_count / maxVol, 1) * 3;
  return Math.min(Math.round((convScore + ticketScore + volScore) * 10) / 10, 10);
}

function scoreColor(score: number): string {
  if (score >= 7) return "bg-success/15 text-success";
  if (score >= 4) return "bg-orange-500/15 text-orange-500";
  return "bg-destructive/15 text-destructive";
}

export function LeadQualityByOrigin({ origins }: Props) {
  if (origins.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className={AT.chartTitle}>Qualidade por Origem</CardTitle></CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados suficientes por origem." detail="Necessário pelo menos 5 leads por origem." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Sparkles className="h-4 w-4" />
          Qualidade de Lead por Origem
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {origins.map((o) => {
          const score = qualityScore(o);
          return (
            <div key={o.origin} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{ORIGIN_LABELS[o.origin] ?? o.origin}</span>
                <Badge className={`text-xs ${scoreColor(score)}`}>
                  Score: {score.toFixed(1)}/10
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Conv. final</span>
                  <div className="font-semibold">{o.conversion_rate}%</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Ticket médio</span>
                  <div className="font-semibold">R$ {(o.avg_ticket / 1000).toFixed(0)}K</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Leads</span>
                  <div className="font-semibold">{o.lead_count}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Vendas</span>
                  <div className="font-semibold">{o.won_count}</div>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
