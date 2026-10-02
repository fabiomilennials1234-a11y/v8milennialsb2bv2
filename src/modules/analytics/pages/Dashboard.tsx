import { useState } from "react";
import { Link } from "react-router-dom";
import { ChartNoAxesCombined, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title="Comando"
        subtitle="Próximos passos da operação."
        actions={
          <>
            {/* Comando é operação; análise vive no Estúdio. O par precisa de
                uma porta explícita, senão a separação vira dois produtos. */}
            <Button asChild variant="outline">
              <Link to="/metricas"><ChartNoAxesCombined />Ver métricas</Link>
            </Button>
            <Button onClick={() => setLeadOpen(true)}><Plus />Novo lead</Button>
          </>
        }
      />
      <TabProximosPassos />
      <LeadModal open={leadOpen} onOpenChange={setLeadOpen} />
    </div>
  );
}
