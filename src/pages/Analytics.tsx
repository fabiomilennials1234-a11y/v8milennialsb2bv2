import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { OverviewTab } from "@/components/analytics/tabs/OverviewTab";
import { FinanceiroTab } from "@/components/analytics/tabs/FinanceiroTab";
import { ComercialTab } from "@/components/analytics/tabs/ComercialTab";
import { PipesFunisTab } from "@/components/analytics/tabs/PipesFunisTab";
import { EngajamentoTab } from "@/components/analytics/tabs/EngajamentoTab";
import { UtmsTab } from "@/components/analytics/tabs/UtmsTab";
import { useOrganization } from "@/hooks/useOrganization";

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("overview");
  const { organizationId } = useOrganization();
  const MILENNIALS_ORG_ID = import.meta.env.VITE_MILENNIALS_ORG_ID || "";
  const showUtmsTab = organizationId === MILENNIALS_ORG_ID;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
      </div>

      <AnalyticsFilters />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">
            Visão Geral
          </TabsTrigger>
          <TabsTrigger value="financeiro">
            Financeiro
          </TabsTrigger>
          <TabsTrigger value="comercial">Comercial</TabsTrigger>
          <TabsTrigger value="pipes">
            Pipes & Funis
          </TabsTrigger>
          <TabsTrigger value="engajamento">
            Engajamento
          </TabsTrigger>
          {showUtmsTab && (
            <TabsTrigger value="utms">UTMs</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="financeiro" className="space-y-4">
          <FinanceiroTab />
        </TabsContent>

        <TabsContent value="comercial" className="space-y-4">
          <ComercialTab />
        </TabsContent>

        <TabsContent value="pipes" className="space-y-4">
          <PipesFunisTab />
        </TabsContent>

        <TabsContent value="engajamento" className="space-y-4">
          <EngajamentoTab />
        </TabsContent>
        {showUtmsTab && (
          <TabsContent value="utms" className="space-y-4">
            <UtmsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
