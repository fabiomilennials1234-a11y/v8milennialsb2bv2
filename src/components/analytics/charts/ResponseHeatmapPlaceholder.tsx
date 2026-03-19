import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

export function ResponseHeatmapPlaceholder() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Heatmap de Resposta WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent>
        <AnalyticsEmptyState
          message="Padrão de resposta disponível na aba Engajamento"
          detail="Acesse a aba Engajamento para ver o padrão horário de respostas e métricas de WhatsApp."
        />
      </CardContent>
    </Card>
  );
}
