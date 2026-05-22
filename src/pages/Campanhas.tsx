import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCampanhas } from "@/hooks/useCampanhas";
import { useCanDo } from "@/hooks/useCanDo";
import { useOrganization } from "@/hooks/useOrganization";
import { trackModuleVisit } from "@/lib/analytics";
import { CampanhaCard } from "@/components/campanhas/CampanhaCard";
import { CreateCampanhaModal } from "@/components/campanhas/CreateCampanhaModal";
import { Plus, Target, Loader2 } from "lucide-react";

export default function Campanhas() {
  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("campanhas", organizationId); }, []);

  const [createOpen, setCreateOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: campanhas, isLoading } = useCampanhas();
  const { allowed: canCreateCampaign } = useCanDo("create_campaign");

  // Auto-open create modal when coming from CreateNewModal
  useEffect(() => {
    if (searchParams.get("create") === "true") {
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Group by status
  const draftCampanhas = campanhas?.filter((c) => c.status === "draft") || [];
  const activeCampanhas = campanhas?.filter((c) => c.status === "active" || (c.is_active && !c.status)) || [];
  const pausedCampanhas = campanhas?.filter((c) => c.status === "paused") || [];
  const endedCampanhas = campanhas?.filter((c) => c.status === "ended" || (!c.is_active && !c.status)) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="w-6 h-6 text-primary" />
            Campanhas
          </h1>
          <p className="text-muted-foreground">
            Gerencie suas campanhas temporárias com metas, prazos e incentivos
          </p>
        </div>

        {canCreateCampaign && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Campanha
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Draft Campaigns */}
          {draftCampanhas.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                Rascunhos
                <Badge variant="secondary" className="text-xs">{draftCampanhas.length}</Badge>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {draftCampanhas.map((campanha) => (
                  <CampanhaCard key={campanha.id} campanha={campanha} />
                ))}
              </div>
            </div>
          )}

          {/* Active Campaigns */}
          {activeCampanhas.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                Campanhas Ativas
                <Badge className="text-xs bg-success">{activeCampanhas.length}</Badge>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeCampanhas.map((campanha) => (
                  <CampanhaCard key={campanha.id} campanha={campanha} />
                ))}
              </div>
            </div>
          )}

          {/* Paused Campaigns */}
          {pausedCampanhas.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-yellow-500">
                Pausadas
                <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-500">{pausedCampanhas.length}</Badge>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-80">
                {pausedCampanhas.map((campanha) => (
                  <CampanhaCard key={campanha.id} campanha={campanha} />
                ))}
              </div>
            </div>
          )}

          {/* Ended Campaigns */}
          {endedCampanhas.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-muted-foreground flex items-center gap-2">
                Encerradas
                <Badge variant="outline" className="text-xs">{endedCampanhas.length}</Badge>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
                {endedCampanhas.map((campanha) => (
                  <CampanhaCard key={campanha.id} campanha={campanha} />
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {campanhas?.length === 0 && (
            <div className="text-center py-12 bg-muted/30 rounded-lg">
              <Target className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhuma campanha ainda</h3>
              <p className="text-muted-foreground mb-4">
                Crie sua primeira campanha temporária com metas e incentivos para a equipe
              </p>
              {canCreateCampaign && (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Criar Campanha
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {/* Create Modal */}
      <CreateCampanhaModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
