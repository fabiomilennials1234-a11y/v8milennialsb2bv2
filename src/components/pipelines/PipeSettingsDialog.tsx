import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Settings2, Layers, Type, Upload, FileDown, Send, Shuffle } from "lucide-react";
import { type PipelineType, type PipelineStage } from "@/hooks/usePipelineStages";
import { type FunnelDestination } from "@/hooks/useImportLeads";
import { ManagePipelineStagesContent } from "./ManagePipelineStagesModal";
import { CustomFieldsManager } from "@/components/leads/CustomFieldsManager";
import { ImportLeadsFunnelContent } from "@/components/leads/ImportLeadsFunnelModal";
import { ExportLeadsContent } from "@/components/leads/ExportLeadsModal";
import { PipeDispatchRulesSection } from "./PipeDispatchRulesSection";
import { PipeDistributionSection } from "./PipeDistributionSection";

const PIPE_LABELS: Record<PipelineType, string> = {
  whatsapp: "Qualificação",
  confirmacao: "Confirmação",
  propostas: "Propostas",
};

const PIPE_TO_DESTINATION: Record<PipelineType, FunnelDestination> = {
  whatsapp: "qualificacao",
  confirmacao: "confirmacao",
  propostas: "propostas",
};

interface PipeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeType: PipelineType;
  stages: PipelineStage[];
  defaultTab?: string;
}

export function PipeSettingsDialog({
  open,
  onOpenChange,
  pipeType,
  stages,
  defaultTab = "etapas",
}: PipeSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Configurações — {PIPE_LABELS[pipeType]}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={defaultTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="etapas" className="gap-1.5 text-xs">
              <Layers className="w-3.5 h-3.5" />
              Etapas
            </TabsTrigger>
            <TabsTrigger value="campos" className="gap-1.5 text-xs">
              <Type className="w-3.5 h-3.5" />
              Campos
            </TabsTrigger>
            <TabsTrigger value="distribuicao" className="gap-1.5 text-xs">
              <Shuffle className="w-3.5 h-3.5" />
              Distribuição
            </TabsTrigger>
            <TabsTrigger value="importar" className="gap-1.5 text-xs">
              <Upload className="w-3.5 h-3.5" />
              Importar
            </TabsTrigger>
            <TabsTrigger value="exportar" className="gap-1.5 text-xs">
              <FileDown className="w-3.5 h-3.5" />
              Exportar
            </TabsTrigger>
            <TabsTrigger value="disparos" className="gap-1.5 text-xs">
              <Send className="w-3.5 h-3.5" />
              Disparos
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            <TabsContent value="etapas" className="mt-0">
              <ManagePipelineStagesContent
                pipelineType={pipeType}
                stages={stages}
              />
            </TabsContent>

            <TabsContent value="campos" className="mt-0">
              <CustomFieldsManager />
            </TabsContent>

            <TabsContent value="distribuicao" className="mt-0">
              <PipeDistributionSection pipeType={pipeType} />
            </TabsContent>

            <TabsContent value="importar" className="mt-0">
              <ImportLeadsFunnelContent
                destination={PIPE_TO_DESTINATION[pipeType]}
              />
            </TabsContent>

            <TabsContent value="exportar" className="mt-0">
              <ExportLeadsContent />
            </TabsContent>

            <TabsContent value="disparos" className="mt-0">
              <PipeDispatchRulesSection
                pipeType={pipeType}
                stages={stages}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
