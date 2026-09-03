import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Settings2,
  Layers,
  Palette,
  FileSpreadsheet,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import {
  type CustomPipeline,
  type CustomPipelineStage,
} from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import {
  useStageDispatchEnabled,
  useSetStageDispatchEnabled,
} from "@/modules/pipelines/hooks/config/useStageDispatchToggle";
import { ManagePipelineStagesContent } from "../shared/ManagePipelineStagesModal";
import { FunnelIdentitySection } from "../shared/FunnelIdentitySection";
import { PipeDispatchRulesSection } from "../shared/PipeDispatchRulesSection";
import { ImportCustomPipelineContent } from "./ImportCustomPipelineContent";

// ────────────────────────────────────────────────────────────
// Dispatch Tab — Mensagens automáticas por etapa (SCRUM-629, D11)
// ────────────────────────────────────────────────────────────

function DispatchTabContent({
  pipeline,
  stages,
}: {
  pipeline: CustomPipeline;
  stages: CustomPipelineStage[];
}) {
  const { data: dispatchState, isLoading } = useStageDispatchEnabled(pipeline.id);
  const setEnabled = useSetStageDispatchEnabled();
  const enabled = dispatchState?.enabled ?? false;

  const handleToggle = async (next: boolean) => {
    try {
      await setEnabled.mutateAsync({ pipelineId: pipeline.id, enabled: next });
      toast.success(
        next
          ? "Mensagens automáticas por etapa ativadas neste funil"
          : "Mensagens automáticas desativadas — envios pendentes deste funil foram cancelados"
      );
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar disparo por etapa");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="stage-dispatch-toggle" className="text-sm font-medium">
            Mensagens automáticas por etapa
          </Label>
          <p className="text-xs text-muted-foreground">
            Quando ligado, mover ou adicionar um card neste funil pode disparar
            mensagens de WhatsApp e ações automáticas conforme as regras abaixo.
            Vale só para movimentos feitos <span className="font-medium text-foreground">depois</span> de
            ligar — cards que já estavam nas etapas não recebem nada.
            Desligar cancela os envios pendentes deste funil.
          </p>
        </div>
        <Switch
          id="stage-dispatch-toggle"
          checked={enabled}
          disabled={isLoading || setEnabled.isPending}
          onCheckedChange={handleToggle}
        />
      </div>

      {enabled ? (
        <PipeDispatchRulesSection
          pipeType={pipeline.slug}
          pipelineId={pipeline.id}
          stages={stages.map((s) => ({ id: s.id, name: s.name }))}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Ative o disparo por etapa para configurar regras de envio neste funil.
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Main Dialog
// ────────────────────────────────────────────────────────────

interface CustomPipeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: CustomPipeline;
  stages: CustomPipelineStage[];
}

/**
 * Configurações do funil CUSTOM — casca fina desde SCRUM-636.
 *
 * A aba "Etapas" renderiza o EDITOR ÚNICO (`ManagePipelineStagesContent`, base
 * do modal de sistema, generalizado por `pipelineId`): o editor inline de ~470
 * linhas que vivia aqui morreu. Com ele o funil custom GANHOU o que só o
 * sistema tinha — "mover os N cards para ___" obrigatório na remoção de etapa,
 * bloqueio visível por regra de disparo apontando, e papel nas métricas
 * (stage_role) com sugestão do classifier.
 */
export function CustomPipeSettingsDialog({
  open,
  onOpenChange,
  pipeline,
  stages,
}: CustomPipeSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Configurações — {pipeline.name}
          </DialogTitle>
        </DialogHeader>

        {/* "Geral" primeiro — e é onde o diálogo abre. Identidade antes de
            mecânica: era a última das quatro, e renomear ou excluir o funil
            exigia atravessar Etapas, Disparos e Importar. */}
        <Tabs defaultValue="geral">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="geral" className="gap-1.5 text-xs">
              <Palette className="w-3.5 h-3.5" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="etapas" className="gap-1.5 text-xs">
              <Layers className="w-3.5 h-3.5" />
              Etapas
            </TabsTrigger>
            <TabsTrigger value="disparos" className="gap-1.5 text-xs">
              <Send className="w-3.5 h-3.5" />
              Disparos
            </TabsTrigger>
            <TabsTrigger value="importar" className="gap-1.5 text-xs">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Importar
            </TabsTrigger>
          </TabsList>

          <div className="overflow-y-auto max-h-[calc(85vh-12rem)] mt-4 pr-1">
            <TabsContent value="geral" className="mt-0">
              <FunnelIdentitySection
                pipeline={{
                  id: pipeline.id,
                  slug: pipeline.slug,
                  type: "custom",
                  name: pipeline.name,
                  icon: pipeline.icon,
                  color: pipeline.color,
                }}
                onDeleted={() => onOpenChange(false)}
              />
            </TabsContent>
            <TabsContent value="etapas" className="mt-0">
              <ManagePipelineStagesContent
                pipelineId={pipeline.id}
                pipelineSlug={pipeline.slug}
                stages={stages}
              />
            </TabsContent>
            <TabsContent value="disparos" className="mt-0">
              <DispatchTabContent pipeline={pipeline} stages={stages} />
            </TabsContent>
            <TabsContent value="importar" className="mt-0">
              <ImportCustomPipelineContent
                pipelineId={pipeline.id}
                pipelineName={pipeline.name}
                stages={stages}
              />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
