import { Loader2 } from "lucide-react";
import { useAnalyticsOverview } from "@/hooks/useAnalyticsOverview";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { CohortHeatmap } from "../charts/CohortHeatmap";
import { UnitEconomicsCards } from "../charts/UnitEconomicsCards";
import { AttributionTable } from "../charts/AttributionTable";
import { SalesVelocity } from "../charts/SalesVelocity";
import { ResponseHeatmapPlaceholder } from "../charts/ResponseHeatmapPlaceholder";
import { AutomatedInsights } from "../charts/AutomatedInsights";

export function OverviewTab() {
  const { data, isLoading } = useAnalyticsOverview();

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
      {/* Row 1: Cohort Heatmap + Unit Economics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <CohortHeatmap cohortData={data.cohort_data} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <UnitEconomicsCards data={data.unit_economics} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 2: Attribution Table + Sales Velocity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <AttributionTable attribution={data.attribution} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <SalesVelocity data={data.sales_velocity} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 3: Response Heatmap Placeholder + Automated Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <ResponseHeatmapPlaceholder />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <AutomatedInsights insights={data.insights} />
        </AnalyticsErrorBoundary>
      </div>
    </div>
  );
}
