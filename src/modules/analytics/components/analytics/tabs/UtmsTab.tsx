import { useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useAnalyticsUtms, type UtmLevel } from "@/modules/analytics/hooks/useAnalyticsUtms";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { UtmBreadcrumb } from "../charts/UtmBreadcrumb";
import { UtmKpiCards } from "../charts/UtmKpiCards";
import { UtmDataTable } from "../charts/UtmDataTable";
import { UtmLeadsList } from "../charts/UtmLeadsList";
import { LeadPanelProvider, useLeadSheet, LeadDetailSheet } from "@/modules/leads";
import { LeadPanelLayout } from "@/components/layout/LeadPanelLayout";

interface DrillDownState {
  level: UtmLevel;
  campaign: string | null;
  campaignMetaId: string | null;
  adset: string | null;
  adsetMetaId: string | null;
  ad: string | null;
}

function UtmsTabInner() {
  const { openLead } = useLeadSheet();
  const [drill, setDrill] = useState<DrillDownState>({
    level: "campaign",
    campaign: null,
    campaignMetaId: null,
    adset: null,
    adsetMetaId: null,
    ad: null,
  });

  const { data, isLoading } = useAnalyticsUtms(
    drill.level,
    drill.campaign,
    drill.adset,
    drill.ad,
    drill.campaignMetaId,
    drill.adsetMetaId,
  );

  const handleDrillDown = useCallback((name: string, metaId: string | null) => {
    if (drill.level === "campaign") {
      setDrill({
        level: "adset",
        campaign: name,
        campaignMetaId: metaId,
        adset: null,
        adsetMetaId: null,
        ad: null,
      });
    } else if (drill.level === "adset") {
      setDrill((prev) => ({
        ...prev,
        level: "ad",
        adset: name,
        adsetMetaId: metaId,
      }));
    } else if (drill.level === "ad") {
      setDrill((prev) => ({
        ...prev,
        level: "leads",
        ad: name,
      }));
    }
  }, [drill.level]);

  const handleNavigate = useCallback((level: UtmLevel, campaign?: string | null, adset?: string | null) => {
    if (level === "campaign") {
      setDrill({
        level: "campaign",
        campaign: null,
        campaignMetaId: null,
        adset: null,
        adsetMetaId: null,
        ad: null,
      });
    } else if (level === "adset") {
      setDrill((prev) => ({
        ...prev,
        level: "adset",
        adset: null,
        adsetMetaId: null,
        ad: null,
      }));
    } else if (level === "ad") {
      setDrill((prev) => ({
        ...prev,
        level: "ad",
        ad: null,
      }));
    }
  }, []);

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
      {/* Breadcrumb */}
      <UtmBreadcrumb
        level={drill.level}
        campaign={drill.campaign}
        adset={drill.adset}
        ad={drill.ad}
        onNavigate={handleNavigate}
      />

      {/* KPI Cards (not shown on leads level) */}
      {drill.level !== "leads" && (
        <AnalyticsErrorBoundary>
          <UtmKpiCards kpis={data.kpis} />
        </AnalyticsErrorBoundary>
      )}

      {/* Data Table or Leads List */}
      {drill.level === "leads" ? (
        <AnalyticsErrorBoundary>
          <UtmLeadsList
            leads={data.leads}
            onOpenLead={(id) => openLead(id)}
          />
        </AnalyticsErrorBoundary>
      ) : (
        <AnalyticsErrorBoundary>
          <UtmDataTable
            data={data.items}
            level={drill.level}
            onDrillDown={handleDrillDown}
          />
        </AnalyticsErrorBoundary>
      )}

    </div>
  );
}

export function UtmsTab() {
  return (
    <LeadPanelProvider>
      <LeadPanelLayout panel={<LeadDetailSheet />}>
        <UtmsTabInner />
      </LeadPanelLayout>
    </LeadPanelProvider>
  );
}
