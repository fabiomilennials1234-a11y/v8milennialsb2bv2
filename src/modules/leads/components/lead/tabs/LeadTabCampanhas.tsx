/**
 * LeadTabCampanhas — tab de vinculação de lead a campanhas ativas.
 *
 * Extraído de LeadDetailContent (Onda 3.1, C10).
 */

import { Target, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Campanha {
  id: string;
  name: string;
  is_active: boolean;
}

interface LeadTabCampanhasProps {
  activeCampanhas: Campanha[];
  selectedCampanhaId: string | null;
  onSelectCampanha: (id: string) => void;
  onAddToCampanha: () => void;
  isAdding?: boolean;
  hasStages?: boolean;
}

export function LeadTabCampanhas({
  activeCampanhas,
  selectedCampanhaId,
  onSelectCampanha,
  onAddToCampanha,
  isAdding = false,
  hasStages = false,
}: LeadTabCampanhasProps) {
  return (
    <div className="space-y-4">
      <div className="text-center pb-2">
        <h4 className="font-medium">Campanhas</h4>
        <p className="text-sm text-muted-foreground">Vincule este lead a uma campanha ativa</p>
      </div>

      {activeCampanhas.length > 0 ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Selecione uma campanha</Label>
            <Select
              value={selectedCampanhaId || ""}
              onValueChange={onSelectCampanha}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha uma campanha..." />
              </SelectTrigger>
              <SelectContent>
                {activeCampanhas.map((campanha) => (
                  <SelectItem key={campanha.id} value={campanha.id}>
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      {campanha.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedCampanhaId && (
            <Button
              className="w-full"
              onClick={onAddToCampanha}
              disabled={isAdding || !hasStages}
            >
              {isAdding ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Adicionar à Campanha
            </Button>
          )}
        </div>
      ) : (
        <div className="text-center py-8">
          <Target className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <p className="text-muted-foreground">Nenhuma campanha ativa no momento</p>
        </div>
      )}
    </div>
  );
}
