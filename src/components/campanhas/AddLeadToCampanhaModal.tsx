import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAddCampanhaLead, CampanhaStage, CampanhaMember } from "@/hooks/useCampanhas";
import { useLeads } from "@/hooks/useLeads";
import { toast } from "sonner";
import { Search, UserPlus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AddLeadToCampanhaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campanhaId: string;
  stages: CampanhaStage[];
  members: CampanhaMember[];
  existingLeadIds: string[];
}

export function AddLeadToCampanhaModal({
  open,
  onOpenChange,
  campanhaId,
  stages,
  members,
  existingLeadIds,
}: AddLeadToCampanhaModalProps) {
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const [selectedSdrId, setSelectedSdrId] = useState<string>("");

  const { data: allLeads } = useLeads();
  const addLead = useAddCampanhaLead();

  // Filter leads that are not already in the campaign
  const availableLeads = allLeads?.filter(
    (lead) =>
      !existingLeadIds.includes(lead.id) &&
      (lead.name.toLowerCase().includes(search.toLowerCase()) ||
        lead.company?.toLowerCase().includes(search.toLowerCase()) ||
        lead.email?.toLowerCase().includes(search.toLowerCase()))
  );

  const handleSubmit = async () => {
    if (!selectedLeadId || !selectedStageId) {
      toast.error("Selecione um lead e uma etapa");
      return;
    }

    try {
      await addLead.mutateAsync({
        campanha_id: campanhaId,
        lead_id: selectedLeadId,
        stage_id: selectedStageId,
        sdr_id: selectedSdrId || undefined,
      });

      toast.success("Lead adicionado à campanha!");
      onOpenChange(false);
      resetForm();
    } catch (error) {
      toast.error("Erro ao adicionar lead");
      console.error(error);
    }
  };

  const resetForm = () => {
    setSearch("");
    setSelectedLeadId(null);
    setSelectedStageId("");
    setSelectedSdrId("");
  };

  const selectedLead = allLeads?.find((l) => l.id === selectedLeadId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Adicionar Lead à Campanha
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="space-y-2">
            <Label>Buscar Lead</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nome, empresa ou email..."
                className="pl-9"
              />
            </div>
          </div>

          {/* Lead List */}
          <ScrollArea className="h-48 rounded-lg border">
            <div className="p-2 space-y-1">
              {availableLeads?.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  Nenhum lead disponível
                </div>
              ) : (
                availableLeads?.slice(0, 20).map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className={`w-full text-left p-2 rounded-lg transition-colors ${
                      selectedLeadId === lead.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    <p className="font-medium text-sm">{lead.name}</p>
                    <p className={`text-xs ${selectedLeadId === lead.id ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {lead.company || lead.email || "Sem informações"}
                    </p>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Selected Lead Info */}
          {selectedLead && (
            <div className="p-3 bg-primary/10 rounded-lg">
              <p className="text-sm font-medium">Selecionado: {selectedLead.name}</p>
              {selectedLead.company && (
                <p className="text-xs text-muted-foreground">{selectedLead.company}</p>
              )}
            </div>
          )}

          {/* Stage Selection */}
          <div className="space-y-2">
            <Label>Etapa Inicial *</Label>
            <Select value={selectedStageId} onValueChange={setSelectedStageId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a etapa" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: stage.color || "#3B82F6" }}
                      />
                      {stage.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* SDR Selection */}
          <div className="space-y-2">
            <Label>Vendedor Responsável</Label>
            <Select value={selectedSdrId} onValueChange={setSelectedSdrId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o vendedor (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.team_member_id} value={member.team_member_id}>
                    {member.team_member?.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!selectedLeadId || !selectedStageId || addLead.isPending}>
              {addLead.isPending ? "Adicionando..." : "Adicionar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
