import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TabProximosPassos } from "@/modules/analytics/components/dashboard/v2/TabProximosPassos";
import { useOrganization, useUserRole, useCurrentTeamMember } from "@/modules/identity";
import { LeadModal } from "@/modules/leads";
import DashboardOutbound from "./DashboardOutbound";

/** Comando é a fila operacional. Os dashboards moram nos templates de /metricas. */
export default function Dashboard() {
  const { orgType, isLoading: orgLoading } = useOrganization();
  const { data: userRole } = useUserRole();
  const { isLoading: memberLoading } = useCurrentTeamMember();
  const [leadOpen, setLeadOpen] = useState(false);

  // Fluxo especializado dos membros outbound permanece intacto.
  if (orgType === "outbound" && userRole?.role === "member") return <DashboardOutbound />;
  if (orgLoading || memberLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-16" /><Skeleton className="h-80" /></div>;
  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div><h1 className="text-xl font-bold tracking-tight">Comando</h1><p className="text-sm text-muted-foreground">Próximos passos da operação.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" onClick={() => setLeadOpen(true)}><Plus className="mr-2 size-4" />Novo lead</Button>
        </div>
      </header>
      <TabProximosPassos />
      <LeadModal open={leadOpen} onOpenChange={setLeadOpen} />
    </div>
  );
}
