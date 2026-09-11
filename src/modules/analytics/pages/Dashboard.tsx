import { useEffect, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TabProximosPassos } from "@/modules/analytics/components/dashboard/v2/TabProximosPassos";
import { OraculoChat } from "@/modules/analytics/components/dashboard/OraculoChat";
import { useOraculoChat } from "@/modules/copilot";
import { useOrgFeaturesOptional } from "@/contexts/OrgFeaturesContext";
import { useOrganization, useUserRole, useCurrentTeamMember } from "@/modules/identity";
import { LeadModal } from "@/modules/leads";
import { useStudioClock } from "@/modules/analytics/hooks/useStudioClock";
import { zonedDateParts } from "@/shared/time/zoned-day";
import DashboardOutbound from "./DashboardOutbound";

/** Comando é a fila operacional. Os dashboards moram nos templates de /metricas. */
export default function Dashboard() {
  const { orgType, timezone, isLoading: orgLoading } = useOrganization();
  const { data: userRole } = useUserRole();
  const { isLoading: memberLoading } = useCurrentTeamMember();
  const [leadOpen, setLeadOpen] = useState(false);
  const now = useStudioClock();
  const { m: month, y: year } = zonedDateParts(now, timezone ?? "UTC");
  const oraculo = useOraculoChat({ month, year });
  const features = useOrgFeaturesOptional();
  const oraculoEnabled = features ? features.hasFeature("oraculo") : true;
  const setOraculoOpen = oraculo.setIsOpen;
  useEffect(() => {
    if (!oraculoEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOraculoOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [oraculoEnabled, setOraculoOpen]);

  // Fluxo especializado dos membros outbound permanece intacto.
  if (orgType === "outbound" && userRole?.role === "member") return <DashboardOutbound />;
  if (orgLoading || memberLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-16" /><Skeleton className="h-80" /></div>;
  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div><h1 className="text-xl font-bold tracking-tight">Comando</h1><p className="text-sm text-muted-foreground">Próximos passos da operação.</p></div>
        <div className="flex flex-wrap gap-2">
          {oraculoEnabled && <Button variant="outline" className="min-h-11" onClick={() => setOraculoOpen(true)}><Sparkles className="mr-2 size-4" />Oráculo</Button>}
          <Button className="min-h-11" onClick={() => setLeadOpen(true)}><Plus className="mr-2 size-4" />Novo lead</Button>
        </div>
      </header>
      <TabProximosPassos />
      <LeadModal open={leadOpen} onOpenChange={setLeadOpen} />
      {oraculoEnabled && oraculo.isOpen && <OraculoChat messages={oraculo.messages} isLoading={oraculo.isLoading}
        rateLimit={oraculo.rateLimit} onSend={oraculo.sendMessage} onClose={() => setOraculoOpen(false)} />}
    </div>
  );
}
