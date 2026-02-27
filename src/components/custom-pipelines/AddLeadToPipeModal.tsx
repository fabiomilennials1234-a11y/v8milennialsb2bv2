import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import {
  useAddLeadToCustomPipe,
  type CustomPipelineStage,
} from "@/hooks/useCustomPipelines";
import { Loader2, Search, Building2, Phone, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";

interface AddLeadToPipeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
  stages: CustomPipelineStage[];
}

interface LeadResult {
  id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
}

export function AddLeadToPipeModal({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
  stages,
}: AddLeadToPipeModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string>(stages[0]?.id || "");
  const debouncedSearch = useDebounce(searchQuery, 300);

  const { data: teamMember } = useCurrentTeamMember();
  const addLead = useAddLeadToCustomPipe();

  // Buscar leads por nome/empresa/telefone
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ["lead_search_for_pipe", debouncedSearch, teamMember?.organization_id],
    queryFn: async () => {
      if (!teamMember?.organization_id || !debouncedSearch.trim()) return [];

      const query = `%${debouncedSearch.trim()}%`;
      const { data, error } = await supabase
        .from("leads")
        .select("id, name, company_name, phone, email")
        .eq("organization_id", teamMember.organization_id)
        .or(`name.ilike.${query},company_name.ilike.${query},phone.ilike.${query}`)
        .limit(20);

      if (error) throw error;
      return (data || []) as LeadResult[];
    },
    enabled: !!teamMember?.organization_id && debouncedSearch.trim().length >= 2,
  });

  const selectedLead = searchResults?.find((l) => l.id === selectedLeadId);

  const handleAdd = async () => {
    if (!selectedLeadId || !selectedStageId) return;

    try {
      await addLead.mutateAsync({
        pipeline_id: pipelineId,
        lead_id: selectedLeadId,
        stage_id: selectedStageId,
      });

      toast.success(`Lead adicionado ao funil "${pipelineName}"`);
      handleClose();
    } catch (error: any) {
      toast.error(error.message || "Erro ao adicionar lead");
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setSearchQuery("");
    setSelectedLeadId(null);
    setSelectedStageId(stages[0]?.id || "");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar Lead ao Funil</DialogTitle>
          <DialogDescription>
            Busque um lead existente e adicione ao funil "{pipelineName}".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Busca */}
          <div className="space-y-2">
            <Label>Buscar Lead</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedLeadId(null);
                }}
                placeholder="Nome, empresa ou telefone..."
                className="pl-9"
                autoFocus
              />
            </div>
          </div>

          {/* Resultados da busca */}
          {debouncedSearch.trim().length >= 2 && (
            <div className="max-h-[200px] overflow-y-auto space-y-1 border rounded-lg p-1">
              {isSearching ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : searchResults && searchResults.length > 0 ? (
                searchResults.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className={cn(
                      "w-full text-left p-2 rounded-md transition-colors",
                      selectedLeadId === lead.id
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted"
                    )}
                  >
                    <div className="font-medium text-sm">{lead.name}</div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {lead.company_name && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Building2 className="w-3 h-3" />
                          {lead.company_name}
                        </span>
                      )}
                      {lead.phone && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="w-3 h-3" />
                          {lead.phone}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  Nenhum lead encontrado
                </div>
              )}
            </div>
          )}

          {/* Lead selecionado */}
          {selectedLead && (
            <div className="flex items-center gap-2 p-2 bg-primary/5 border border-primary/20 rounded-lg">
              <UserCheck className="w-4 h-4 text-primary shrink-0" />
              <div className="text-sm">
                <span className="font-medium">{selectedLead.name}</span>
                {selectedLead.company_name && (
                  <span className="text-muted-foreground"> — {selectedLead.company_name}</span>
                )}
              </div>
            </div>
          )}

          {/* Etapa inicial */}
          <div className="space-y-2">
            <Label>Etapa Inicial</Label>
            <Select
              value={selectedStageId}
              onValueChange={setSelectedStageId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a etapa..." />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: stage.color || "#64748b" }}
                      />
                      {stage.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!selectedLeadId || !selectedStageId || addLead.isPending}
          >
            {addLead.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
