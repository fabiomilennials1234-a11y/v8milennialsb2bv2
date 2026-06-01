import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useExtractLeadToPipe, type CampanhaLead, type ExtractLeadToPipeTarget } from "@/modules/campaigns/hooks/useCampanhas";
import { usePipelineStages, type PipelineType } from "@/modules/pipelines";
import { MessageSquare, CalendarCheck, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

const PIPE_OPTIONS: { target: ExtractLeadToPipeTarget; label: string; pipelineType: PipelineType; icon: typeof MessageSquare }[] = [
  { target: "pipe_whatsapp", label: "Pipe de Qualificação", pipelineType: "whatsapp", icon: MessageSquare },
  { target: "pipe_confirmacao", label: "Pipe Confirmação", pipelineType: "confirmacao", icon: CalendarCheck },
  { target: "pipe_propostas", label: "Pipe de Propostas", pipelineType: "propostas", icon: FileText },
];

interface ExtractToPipeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: CampanhaLead | null;
  campanhaId: string;
  campanhaName: string;
  organizationId: string | null;
  onSuccess?: () => void;
}

export function ExtractToPipeModal({
  open,
  onOpenChange,
  lead,
  campanhaId,
  campanhaName,
  organizationId,
  onSuccess,
}: ExtractToPipeModalProps) {
  const [selectedPipe, setSelectedPipe] = useState<ExtractLeadToPipeTarget | "">("");
  const [selectedStage, setSelectedStage] = useState<string>("");

  const pipeOption = PIPE_OPTIONS.find((o) => o.target === selectedPipe);
  const pipelineType = pipeOption?.pipelineType ?? "whatsapp";
  const { data: stages = [] } = usePipelineStages(pipelineType);

  useEffect(() => {
    if (!open) {
      setSelectedPipe("");
      setSelectedStage("");
    }
  }, [open]);

  useEffect(() => {
    if (selectedPipe && stages.length > 0) {
      const firstKey = stages[0]?.stage_key ?? stages[0]?.id ?? "novo";
      setSelectedStage((prev) => (stages.some((s) => (s.stage_key ?? s.id) === prev) ? prev : firstKey));
    } else {
      setSelectedStage("");
    }
  }, [selectedPipe, stages]);

  const extract = useExtractLeadToPipe();

  if (!lead) return null;

  const handleExtract = async () => {
    if (!organizationId) {
      toast.error("Organização não definida");
      return;
    }
    if (!selectedPipe || !selectedStage) {
      toast.error("Escolha o pipe e a etapa");
      return;
    }
    try {
      await extract.mutateAsync({
        campanha_lead_id: lead.id,
        campanha_id: campanhaId,
        lead_id: lead.lead_id,
        target_pipe: selectedPipe,
        stage: selectedStage,
        organization_id: organizationId,
        responsible_id: lead.responsible_id ?? lead.sdr_id ?? lead.lead?.closer_id ?? undefined,
        campaign_name: campanhaName,
      });
      const pipeLabel = PIPE_OPTIONS.find((o) => o.target === selectedPipe)?.label ?? selectedPipe;
      const stageLabel = stages.find((s) => (s.stage_key ?? s.id) === selectedStage)?.name ?? selectedStage;
      toast.success(`Lead enviado para ${pipeLabel} na etapa "${stageLabel}" e removido da campanha`);
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao enviar lead para o pipe");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar lead para pipe</DialogTitle>
          <DialogDescription>
            O lead <strong>{lead.lead?.name}</strong> sairá desta campanha e entrará no pipe na etapa que você escolher.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Pipe</Label>
            <Select value={selectedPipe} onValueChange={(v) => setSelectedPipe(v as ExtractLeadToPipeTarget)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o pipe" />
              </SelectTrigger>
              <SelectContent>
                {PIPE_OPTIONS.map(({ target, label, icon: Icon }) => (
                  <SelectItem key={target} value={target}>
                    <span className="flex items-center gap-2">
                      <Icon className="w-4 h-4 shrink-0" />
                      {label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedPipe && (
            <div className="space-y-2">
              <Label>Etapa no pipe</Label>
              <Select value={selectedStage} onValueChange={setSelectedStage}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a etapa" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => {
                    const key = s.stage_key ?? s.id;
                    return (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          {s.color && (
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: s.color }}
                            />
                          )}
                          {s.name}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleExtract}
            disabled={!selectedPipe || !selectedStage || extract.isPending}
          >
            {extract.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0 mr-2" />
            ) : null}
            Enviar para pipe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
