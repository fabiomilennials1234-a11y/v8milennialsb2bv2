import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { OverviewTab } from "@/components/analytics/tabs/OverviewTab";
import { FinanceiroTab } from "@/components/analytics/tabs/FinanceiroTab";
import { ComercialTab } from "@/components/analytics/tabs/ComercialTab";
import { PipesFunisTab } from "@/components/analytics/tabs/PipesFunisTab";
import { EngajamentoTab } from "@/components/analytics/tabs/EngajamentoTab";

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("overview");

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
      </Tabs>
    </div>
  );
}
