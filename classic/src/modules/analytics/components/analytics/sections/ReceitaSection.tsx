import { DollarSign, Loader2 } from "lucide-react";
import { useAnalyticsFinanceiro } from "@/modules/analytics/hooks/useAnalyticsFinanceiro";
import { useAnalyticsOverview } from "@/modules/analytics/hooks/useAnalyticsOverview";
import { AnalyticsSectionHeader } from "../AnalyticsSectionHeader";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { RevenueComposition } from "../charts/RevenueComposition";
import { MRREvolution } from "../charts/MRREvolution";
import { TicketEvolution } from "../charts/TicketEvolution";
import { Projection90d } from "../charts/Projection90d";
import { SellerProfitability } from "../charts/SellerProfitability";
import { UnitEconomicsCards } from "../charts/UnitEconomicsCards";
import { CohortHeatmap } from "../charts/CohortHeatmap";

export function ReceitaSection() {
  const { data: finData, isLoading: finLoading, isError: finError, error: finErr } = useAnalyticsFinanceiro();
  const { data: overviewData, isError: overviewError } = useAnalyticsOverview();

  if (finLoading) {
    return (
      <div>
        <AnalyticsSectionHeader
          icon={DollarSign}
          title="Receita"
          description="Quanto está faturando e pra onde vai?"
        />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (finError) {
    return (
      <div>
        <AnalyticsSectionHeader icon={DollarSign} title="Receita" description="Quanto está faturando e pra onde vai?" />
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">Erro ao carregar receita</p>
          <p className="text-xs text-muted-foreground mt-1">{finErr?.message}</p>
        </div>
      </div>
    );
  }

  if (!finData) return null;

  return (
    <div>
      <AnalyticsSectionHeader
        icon={DollarSign}
        title="Receita"
        description="Quanto está faturando e pra onde vai?"
      />

      <div className="space-y-4">
        {/* Row 1: Revenue Composition + MRR Evolution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnalyticsErrorBoundary>
            <RevenueComposition
              data={finData.revenue_by_type}
              totalRevenue={finData.total_revenue}
            />
          </AnalyticsErrorBoundary>
          <AnalyticsErrorBoundary>
            <MRREvolution data={finData.mrr_evolution} />
          </AnalyticsErrorBoundary>
        </div>

        {/* Row 2: Ticket Evolution + Projection 90d */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnalyticsErrorBoundary>
            <TicketEvolution data={finData.ticket_by_type} />
          </AnalyticsErrorBoundary>
          <AnalyticsErrorBoundary>
            <Projection90d
              mrrEvolution={finData.mrr_evolution}
              totalRevenue={finData.total_revenue}
              newCustomers={finData.new_customers}
            />
          </AnalyticsErrorBoundary>
        </div>

        {/* Row 3: Seller Profitability + Unit Economics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnalyticsErrorBoundary>
            <SellerProfitability data={finData.seller_profitability} />
          </AnalyticsErrorBoundary>
          {overviewData && (
            <AnalyticsErrorBoundary>
              <UnitEconomicsCards data={overviewData.unit_economics} />
            </AnalyticsErrorBoundary>
          )}
        </div>

        {/* Full-width: Cohort Heatmap */}
        {overviewData && (
          <AnalyticsErrorBoundary>
            <CohortHeatmap cohortData={overviewData.cohort_data} />
          </AnalyticsErrorBoundary>
        )}
      </div>
    </div>
  );
}
