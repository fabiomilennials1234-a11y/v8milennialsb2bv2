/**
 * Contexto do funil: Qualificação (WhatsApp)
 *
 * Shows current stage, responsible, origin info, and quick status actions.
 */

import { useState } from "react";
import { MessageSquare, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type PipeWhatsappStatus, stagesToColumns } from "@/contracts/pipe";
import { usePipeOps } from "../../../pipe-ops";
import { useResponsibleMembers } from "@/modules/identity";
import { useLogLeadAction } from "../../../hooks/useLogLeadAction";
import { useOpenWhatsAppChat, formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface WhatsAppContextProps {
  lead: any;
  pipeData: any;
  onSuccess?: () => void;
}

export function WhatsAppContext({ lead, pipeData, onSuccess }: WhatsAppContextProps) {
  const { useUpdatePipeWhatsapp, usePipelineStages } = usePipeOps();
  const updatePipe = useUpdatePipeWhatsapp();
  const logAction = useLogLeadAction();
  const responsibleMembers = useResponsibleMembers();
  const openWhatsApp = useOpenWhatsAppChat();
  const { data: stages = [] } = usePipelineStages("whatsapp");
  const [isUpdating, setIsUpdating] = useState(false);

  const stageColumns = stagesToColumns(stages);
  const currentStage = stageColumns.find((s) => s.id === pipeData?.status);

  const handleStageChange = async (newStatus: string) => {
    if (!pipeData) return;
    setIsUpdating(true);
    try {
      await updatePipe.mutateAsync({
        id: pipeData.id,
        status: newStatus as PipeWhatsappStatus,
        leadId: pipeData.lead_id,
        sdrId: pipeData.sdr_id,
      });
      const stageLabel = stageColumns.find((s) => s.id === newStatus)?.title || newStatus;
      logAction({ leadId: pipeData.lead_id, action: "stage_changed", description: `Etapa alterada para "${stageLabel}" no Funil WhatsApp` });
      toast.success("Etapa atualizada!");
      onSuccess?.();
    } catch {
      toast.error("Erro ao atualizar etapa");
    } finally {
      setIsUpdating(false);
    }
  };

  if (!pipeData) {
    return <p className="text-sm text-muted-foreground">Dados do funil não disponíveis.</p>;
  }

  const hasPhone = !!formatPhoneForWhatsApp(lead?.phone);

  return (
    <div className="space-y-4">
      {/* Current Stage */}
      <div>
        <Label className="text-xs text-muted-foreground">Etapa atual</Label>
        <div className="flex items-center gap-2 mt-1">
          {currentStage && (
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: currentStage.color }} />
          )}
          <Select
            value={pipeData.status}
            onValueChange={handleStageChange}
            disabled={isUpdating}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stageColumns.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.title}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isUpdating && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Stage progress pills */}
      <div className="flex flex-wrap gap-1.5">
        {stageColumns.map((stage) => {
          const isCurrent = stage.id === pipeData.status;
          const currentIdx = stageColumns.findIndex((s) => s.id === pipeData.status);
          const stageIdx = stageColumns.findIndex((s) => s.id === stage.id);
          const isPast = stageIdx < currentIdx;

          return (
            <Badge
              key={stage.id}
              variant="outline"
              className={cn(
                "text-[10px] cursor-pointer transition-colors",
                isCurrent && "ring-1 ring-primary",
                isPast && "opacity-50",
              )}
              style={isCurrent ? { backgroundColor: `${stage.color}20`, color: stage.color, borderColor: stage.color } : undefined}
              onClick={() => handleStageChange(stage.id)}
            >
              {stage.title}
            </Badge>
          );
        })}
      </div>

      {/* WhatsApp quick action */}
      {hasPhone && (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => openWhatsApp(lead.phone)}
        >
          <MessageSquare className="w-4 h-4 text-[#25D366]" />
          Abrir WhatsApp
        </Button>
      )}

      {/* Responsible */}
      <div>
        <Label className="text-xs text-muted-foreground">Responsável no funil</Label>
        <p className="text-sm font-medium mt-1">
          {pipeData.responsible?.name || pipeData.sdr?.name || "Não atribuído"}
        </p>
      </div>
    </div>
  );
}
