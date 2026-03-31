import { Loader2 } from "lucide-react";
import { useAnalyticsFinanceiro } from "@/hooks/useAnalyticsFinanceiro";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { RevenueComposition } from "../charts/RevenueComposition";
import { MRREvolution } from "../charts/MRREvolution";
import { SellerProfitability } from "../charts/SellerProfitability";
import { Projection90d } from "../charts/Projection90d";
import { CACByOriginTrend } from "../charts/CACByOriginTrend";
import { TicketEvolution } from "../charts/TicketEvolution";

export function FinanceiroTab() {
  const { data, isLoading } = useAnalyticsFinanceiro();

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
      {/* Row 1: Revenue Composition + Recorrência Evolution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <RevenueComposition
            data={data.revenue_by_type}
            totalRevenue={data.total_revenue}
          />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <MRREvolution data={data.mrr_evolution} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 2: Seller Profitability + 90d Projection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <SellerProfitability data={data.seller_profitability} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <Projection90d
            mrrEvolution={data.mrr_evolution}
            totalRevenue={data.total_revenue}
            newCustomers={data.new_customers}
          />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 3: CAC by Origin + Ticket Evolution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <CACByOriginTrend data={data.cac_by_origin} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <TicketEvolution data={data.ticket_by_type} />
        </AnalyticsErrorBoundary>
      </div>
    </div>
  );
}
