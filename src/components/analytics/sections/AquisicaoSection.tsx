import { useMemo, useState } from "react";
import { Radio, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalyticsSectionHeader } from "../AnalyticsSectionHeader";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { AttributionTable } from "../charts/AttributionTable";
import { CACByOriginTrend } from "../charts/CACByOriginTrend";
import { LeadQualityByOrigin } from "../charts/LeadQualityByOrigin";
import { MktOriginRanking } from "@/components/marketing/MktOriginRanking";
import { MktOriginCard } from "@/components/marketing/MktOriginCard";
import { MktConfigModal } from "@/components/marketing/MktConfigModal";
import { useAnalyticsOverview } from "@/hooks/useAnalyticsOverview";
import { useAnalyticsFinanceiro } from "@/hooks/useAnalyticsFinanceiro";
import { useAnalyticsComercial } from "@/hooks/useAnalyticsComercial";
import { useMktByOrigin } from "@/hooks/useMktByOrigin";
import { useMktOriginConfigs } from "@/hooks/useMktOriginConfig";
import { useIdentity } from "@/modules/identity";
interface Props {
  month: number;
  year: number;
}

export function AquisicaoSection({ month, year }: Props) {
  const [configOpen, setConfigOpen] = useState(false);
  const { isAdmin } = useIdentity();

  const { data: overviewData, isError: overviewError } = useAnalyticsOverview();
  const { data: financeiroData, isError: financeiroError } = useAnalyticsFinanceiro();
  const { data: comercialData, isError: comercialError } = useAnalyticsComercial();
  const { byOrigin, summary } = useMktByOrigin(month, year);
  const { configMap } = useMktOriginConfigs(month, year);

  const sortedOrigins = useMemo(
    () => [...byOrigin].sort((a, b) => b.conversionRate - a.conversionRate),
    [byOrigin]
  );

  const rankMap = useMemo(() => {
    const map: Record<string, number> = {};
    sortedOrigins.forEach((o, i) => { map[o.origin] = i + 1; });
    return map;
  }, [sortedOrigins]);

  return (
    <div>
      <AnalyticsSectionHeader
        icon={Radio}
        title="Aquisição"
        description="De onde vêm seus leads e quanto custa cada um?"
      />

      {(overviewError || financeiroError || comercialError) && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive mb-4">
          <p className="font-medium">Erro ao carregar dados de aquisição</p>
          <p className="text-xs text-muted-foreground mt-1">Alguns widgets podem estar indisponíveis.</p>
        </div>
      )}

      {/* Row 1: Attribution Table + Origin Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {overviewData && (
          <AnalyticsErrorBoundary>
            <AttributionTable attribution={overviewData.attribution} />
          </AnalyticsErrorBoundary>
        )}
        <AnalyticsErrorBoundary>
          <MktOriginRanking origins={sortedOrigins} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 2: Origin Cards */}
      {sortedOrigins.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Desempenho por Origem
            </p>
            {isAdmin && (
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setConfigOpen(true)}
                title="Configurar investimentos"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {sortedOrigins.map((metrics, i) => (
              <MktOriginCard
                key={metrics.origin}
                metrics={metrics}
                config={configMap[metrics.origin]}
                rank={rankMap[metrics.origin]}
                index={i}
              />
            ))}
          </div>
        </div>
      )}

      {/* Row 3: CAC + Lead Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {financeiroData && (
          <AnalyticsErrorBoundary>
            <CACByOriginTrend data={financeiroData.cac_by_origin} />
          </AnalyticsErrorBoundary>
        )}
        {comercialData && (
          <AnalyticsErrorBoundary>
            <LeadQualityByOrigin origins={comercialData.origin_quality} />
          </AnalyticsErrorBoundary>
        )}
      </div>

      <MktConfigModal
        open={configOpen}
        onOpenChange={setConfigOpen}
        month={month}
        year={year}
        configMap={configMap}
      />
    </div>
  );
}
