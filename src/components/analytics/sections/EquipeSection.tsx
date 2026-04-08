import { Users, Loader2 } from "lucide-react";
import { useAnalyticsEngajamento } from "@/hooks/useAnalyticsEngajamento";
import { useAnalyticsComercial } from "@/hooks/useAnalyticsComercial";
import { AnalyticsSectionHeader } from "../AnalyticsSectionHeader";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { EngagementKPIs } from "../charts/EngagementKPIs";
import { TeamResponseTimes } from "../charts/TeamResponseTimes";
import { HourlyResponsePattern } from "../charts/HourlyResponsePattern";
import { SpeedConversionCorrelation } from "../charts/SpeedConversionCorrelation";
import { CopilotVsHuman } from "../charts/CopilotVsHuman";
import { RankingEvolution } from "../charts/RankingEvolution";
import { RadarComparison } from "../charts/RadarComparison";
import { WinLossAnalysis } from "../charts/WinLossAnalysis";
import { SellerTrend } from "../charts/SellerTrend";
import { EngagementTrends } from "../charts/EngagementTrends";
import { ResponseByOrigin } from "../charts/ResponseByOrigin";
import { ConversionMatrix } from "../charts/ConversionMatrix";

export function EquipeSection() {
  const { data: engData, isLoading: engLoading } = useAnalyticsEngajamento();
  const { data: comData, isLoading: comLoading } = useAnalyticsComercial();

  const isLoading = engLoading || comLoading;

  return (
    <div>
      <AnalyticsSectionHeader
        icon={Users}
        title="Equipe"
        description="Como está a performance do seu time?"
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Engagement KPIs */}
          {engData && (
            <AnalyticsErrorBoundary>
              <EngagementKPIs data={engData.kpi_cards} />
            </AnalyticsErrorBoundary>
          )}

          {/* Row 1: Team Response + Hourly Pattern */}
          {engData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AnalyticsErrorBoundary>
                <TeamResponseTimes data={engData.team_response_times} />
              </AnalyticsErrorBoundary>
              <AnalyticsErrorBoundary>
                <HourlyResponsePattern data={engData.hourly_pattern} />
              </AnalyticsErrorBoundary>
            </div>
          )}

          {/* Row 2: Speed-Conversion + Copilot vs Human */}
          {engData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AnalyticsErrorBoundary>
                <SpeedConversionCorrelation data={engData.speed_conversion} />
              </AnalyticsErrorBoundary>
              <AnalyticsErrorBoundary>
                <CopilotVsHuman data={engData.copilot_vs_human} />
              </AnalyticsErrorBoundary>
            </div>
          )}

          {/* Row 3: Ranking Evolution + Radar Comparison */}
          {comData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AnalyticsErrorBoundary>
                <RankingEvolution members={comData.member_stats} />
              </AnalyticsErrorBoundary>
              <AnalyticsErrorBoundary>
                <RadarComparison members={comData.member_stats} />
              </AnalyticsErrorBoundary>
            </div>
          )}

          {/* Row 4: Win/Loss + Seller Trend */}
          {comData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AnalyticsErrorBoundary>
                <WinLossAnalysis
                  lossReasons={comData.loss_reasons}
                  totalLost={comData.total_lost}
                  totalLossReasons={comData.total_loss_reasons}
                />
              </AnalyticsErrorBoundary>
              <AnalyticsErrorBoundary>
                <SellerTrend members={comData.member_stats} />
              </AnalyticsErrorBoundary>
            </div>
          )}

          {/* Row 5: Response by Origin + Conversion Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {engData && (
              <AnalyticsErrorBoundary>
                <ResponseByOrigin data={engData.response_by_origin} />
              </AnalyticsErrorBoundary>
            )}
            {comData && (
              <AnalyticsErrorBoundary>
                <ConversionMatrix
                  members={comData.member_stats}
                  totalLeads={comData.total_leads}
                />
              </AnalyticsErrorBoundary>
            )}
          </div>

          {/* Full-width: Engagement Trends */}
          {engData && (
            <AnalyticsErrorBoundary>
              <EngagementTrends data={engData.monthly_trends} />
            </AnalyticsErrorBoundary>
          )}
        </div>
      )}
    </div>
  );
}
