import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { ComercialTab } from "@/components/analytics/tabs/ComercialTab";

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("comercial");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
      </div>

      <AnalyticsFilters />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" disabled>
            Visão Geral
          </TabsTrigger>
          <TabsTrigger value="financeiro" disabled>
            Financeiro
          </TabsTrigger>
          <TabsTrigger value="comercial">Comercial</TabsTrigger>
          <TabsTrigger value="pipes" disabled>
            Pipes & Funis
          </TabsTrigger>
          <TabsTrigger value="engajamento" disabled>
            Engajamento
          </TabsTrigger>
        </TabsList>

        <TabsContent value="comercial" className="space-y-4">
          <ComercialTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
