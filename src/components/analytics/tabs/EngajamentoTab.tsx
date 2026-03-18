import { Loader2 } from "lucide-react";
import { useAnalyticsEngajamento } from "@/hooks/useAnalyticsEngajamento";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { EngagementKPIs } from "../charts/EngagementKPIs";
import { ResponseByOrigin } from "../charts/ResponseByOrigin";
import { TeamResponseTimes } from "../charts/TeamResponseTimes";
import { HourlyResponsePattern } from "../charts/HourlyResponsePattern";
import { SpeedConversionCorrelation } from "../charts/SpeedConversionCorrelation";
import { EngagementTrends } from "../charts/EngagementTrends";
import { CopilotVsHuman } from "../charts/CopilotVsHuman";

export function EngajamentoTab() {
  const { data, isLoading } = useAnalyticsEngajamento();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <AnalyticsErrorBoundary>
        <EngagementKPIs data={data.kpi_cards} />
      </AnalyticsErrorBoundary>

      {/* Row 1: Response by Origin + Team Response Times */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <ResponseByOrigin data={data.response_by_origin} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <TeamResponseTimes data={data.team_response_times} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 2: Hourly Pattern + Speed Conversion */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <HourlyResponsePattern data={data.hourly_pattern} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <SpeedConversionCorrelation data={data.speed_conversion} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 3: Engagement Trends + Copilot vs Human */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <EngagementTrends data={data.monthly_trends} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <CopilotVsHuman data={data.copilot_vs_human} />
        </AnalyticsErrorBoundary>
      </div>
    </div>
  );
}
