import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChartNoAxesCombined, Plus, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TabProximosPassos } from "@/modules/analytics/components/dashboard/v2/TabProximosPassos";
import { ComandoVisaoProvider, type ComandoVisao } from "@/modules/analytics/hooks/useComandoScope";
import { useOrganization, useUserRole, useCurrentTeamMember, useIdentity, isVirtualTeamMember } from "@/modules/identity";
import { LeadModal } from "@/modules/leads";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import DashboardOutbound from "./DashboardOutbound";

/** Comando é a fila operacional. Os dashboards moram nos templates de /metricas. */
export default function Dashboard() {
  const navigate = useNavigate();
  const { orgType, isLoading: orgLoading } = useOrganization();
  const { data: userRole } = useUserRole();
  const { isLoading: memberLoading } = useCurrentTeamMember();
  const { isAdmin, teamMemberId } = useIdentity();
  const [leadOpen, setLeadOpen] = useState(false);
  const [visao, setVisao] = useState<ComandoVisao>("equipe");
  const { hasFeature } = useOrgFeatures();

  // Fluxo especializado dos membros outbound permanece intacto.
  if (orgType === "outbound" && userRole?.role === "member") return <DashboardOutbound />;
  if (orgLoading || memberLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-16" /><Skeleton className="h-80" /></div>;

  // Só quem vê a equipe E tem um `team_member` real alterna para "minha":
  // master/gestor têm id virtual e não teriam o que filtrar (ver useComandoScope).
  const podeAlternar = isAdmin && !!teamMemberId && !isVirtualTeamMember(teamMemberId);
  const vendoEquipe = isAdmin && !(podeAlternar && visao === "minha");

  return (
    <ComandoVisaoProvider value={visao}>
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Comando"
          subtitle={vendoEquipe ? "Próximos passos da operação — central de trabalho da equipe." : "Sua central de trabalho."}
          tabs={
            podeAlternar ? (
              <Tabs value={visao} onValueChange={(v) => setVisao(v as ComandoVisao)}>
                <TabsList variant="pill" aria-label="Visão do Comando">
                  <TabsTrigger value="equipe">Central da equipe</TabsTrigger>
                  <TabsTrigger value="minha">Minha central</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : undefined
          }
          // Comando é operação; análise vive no Estúdio e a parede na TV. As
          // portas ficam à mão, mas como ícone — o primário é criar lead.
          secondaryActions={[
            // A TV é recurso de plano (`FeatureRoute feature="tv_dashboard"`):
            // a porta só aparece para quem a rota deixaria entrar.
            ...(hasFeature("tv_dashboard")
              ? [{ label: "Modo TV", icon: Tv, onSelect: () => navigate("/tv"), iconOnly: true }]
              : []),
            { label: "Ver métricas", icon: ChartNoAxesCombined, onSelect: () => navigate("/metricas"), iconOnly: true },
          ]}
          secondaryActionsLabel="Mais ações do Comando"
          actions={<Button onClick={() => setLeadOpen(true)}><Plus />Novo lead</Button>}
        />
        <TabProximosPassos />
        <LeadModal open={leadOpen} onOpenChange={setLeadOpen} />
      </div>
    </ComandoVisaoProvider>
  );
}
