import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCampanhas } from "@/hooks/useCampanhas";
import { useIsAdmin } from "@/hooks/useUserRole";
import { CampanhaCard } from "@/components/campanhas/CampanhaCard";
import { CreateCampanhaModal } from "@/components/campanhas/CreateCampanhaModal";
import { Plus, Target, Loader2 } from "lucide-react";

export default function Campanhas() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: campanhas, isLoading } = useCampanhas();
  const { isAdmin } = useIsAdmin();

  const activeCampanhas = campanhas?.filter((c) => c.is_active) || [];
  const inactiveCampanhas = campanhas?.filter((c) => !c.is_active) || [];

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
            Gerencie suas campanhas de vendas com metas e bônus gamificados
          </p>
        </div>
        
        {isAdmin && (
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
          {/* Active Campaigns */}
          {activeCampanhas.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Campanhas Ativas</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeCampanhas.map((campanha) => (
                  <CampanhaCard key={campanha.id} campanha={campanha} />
                ))}
              </div>
            </div>
          )}

          {/* Inactive Campaigns */}
          {inactiveCampanhas.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-muted-foreground">Encerradas</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
                {inactiveCampanhas.map((campanha) => (
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
                Crie sua primeira campanha para começar a gamificar suas vendas
              </p>
              {isAdmin && (
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