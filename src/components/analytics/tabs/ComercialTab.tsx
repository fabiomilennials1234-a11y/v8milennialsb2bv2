import { Loader2 } from "lucide-react";
import { useAnalyticsComercial } from "@/hooks/useAnalyticsComercial";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { RadarComparison } from "../charts/RadarComparison";
import { RankingEvolution } from "../charts/RankingEvolution";
import { ConversionMatrix } from "../charts/ConversionMatrix";
import { LeadQualityByOrigin } from "../charts/LeadQualityByOrigin";
import { WinLossAnalysis } from "../charts/WinLossAnalysis";
import { SellerTrend } from "../charts/SellerTrend";

export function ComercialTab() {
  const { data, isLoading } = useAnalyticsComercial();

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
      {/* Row 1: Radar + Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <RadarComparison members={data.member_stats} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <RankingEvolution members={data.member_stats} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 2: Conversion Matrix + Lead Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <ConversionMatrix
            members={data.member_stats}
            totalLeads={data.total_leads}
          />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <LeadQualityByOrigin origins={data.origin_quality} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 3: Win/Loss + Seller Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <WinLossAnalysis
            lossReasons={data.loss_reasons}
            totalLost={data.total_lost}
            totalLossReasons={data.total_loss_reasons}
          />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <SellerTrend members={data.member_stats} />
        </AnalyticsErrorBoundary>
      </div>
    </div>
  );
}
