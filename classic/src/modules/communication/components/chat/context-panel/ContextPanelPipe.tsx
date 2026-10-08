/**
 * ContextPanelPipe — pipelines do lead na 3ª coluna do ChatShell.
 *
 * C39: usa useLeadAllPipelines para mostrar estágios atuais.
 */
import { GitBranch, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useLeadByPhone } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
import { useLeadAllPipelines } from "@/modules/leads";

export interface ContextPanelPipeProps {
  phoneNumber?: string;
}

export function ContextPanelPipe({ phoneNumber }: ContextPanelPipeProps) {
  const { data: lead, isLoading: leadLoading } = useLeadByPhone(phoneNumber ?? null);
  const { data: pipelines = [], isLoading: pipesLoading } = useLeadAllPipelines(lead?.id ?? null);

  const isLoading = leadLoading || pipesLoading;

  if (!phoneNumber) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] p-6 text-center">
        <p className="text-sm text-muted-foreground">Selecione uma conversa</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-2 p-6 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Nenhum lead vinculado</p>
      </div>
    );
  }

  const activePipelines = pipelines.filter((p) =>
    p.type === "standard" ? !!p.pipeId : !!p.entryId
  );

  if (activePipelines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-2 p-6 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Lead não está em nenhum funil</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-2 px-4 space-y-2">
        {activePipelines.map((pipeline) => {
          const key = pipeline.type === "standard" ? pipeline.pipeType : pipeline.pipelineId;
          const label = pipeline.type === "standard" ? pipeline.label : pipeline.pipelineName;
          const color = pipeline.type === "standard" ? pipeline.color : pipeline.pipelineColor;
          const currentLabel =
            pipeline.type === "standard"
              ? pipeline.currentStageLabel
              : pipeline.currentStageName;

          return (
            <div key={key} className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-medium text-foreground truncate">{label}</span>
                <span className="text-[11px] text-muted-foreground truncate">{currentLabel}</span>
              </div>
              <Badge variant="secondary" className="text-[11px] shrink-0">
                {currentLabel}
              </Badge>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
