import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings2, Layers, Type, Upload, FileDown, Send, Shuffle, Clock } from "lucide-react";
import { type PipelineType, type PipelineStage } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { type FunnelDestination } from "@/modules/leads";
import { ManagePipelineStagesContent } from "./ManagePipelineStagesModal";
import { CustomFieldsManager } from "@/modules/leads";
import { ImportLeadsFunnelContent } from "@/modules/leads";
import { ExportLeadsContent } from "@/modules/leads";
import { PipeDispatchRulesSection } from "./PipeDispatchRulesSection";
import { PipeDistributionSection } from "./PipeDistributionSection";
import type { ReactNode } from "react";

const PIPE_LABELS: Record<PipelineType, string> = {
  whatsapp: "Qualificação",
  confirmacao: "Confirmação",
  propostas: "Propostas",
  upsell_base: "Carteira Base",
  upsell_gestao: "Carteira Gestão",
};

const PIPE_TO_DESTINATION: Partial<Record<PipelineType, FunnelDestination>> = {
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
  /**
   * Slots de upsell (carteira) — injetados pelos call sites de carteira.
   * Inversão de dependência: `pipelines` NÃO importa `carteira`. Quando
   * `pipeType` é upsell_base/upsell_gestao, o consumidor de carteira passa
   * estes render slots. Mesma estratégia do `CompareceuModal` (F7).
   */
  upsellRulesSlot?: ReactNode;
  upsellImportSlot?: ReactNode;
}

export function PipeSettingsDialog({
  open,
  onOpenChange,
  pipeType,
  stages,
  defaultTab = "etapas",
  upsellRulesSlot,
  upsellImportSlot,
}: PipeSettingsDialogProps) {
  const isUpsellBase = pipeType === "upsell_base";
  const isUpsellGestao = pipeType === "upsell_gestao";
  const isUpsell = isUpsellBase || isUpsellGestao;
  const destination = PIPE_TO_DESTINATION[pipeType];

  // upsell_base: Etapas + Regras + Importar (3 tabs). upsell_gestao: Etapas + Importar (2 tabs). Others: 6 tabs.
  const tabCount = isUpsellGestao ? 2 : isUpsellBase ? 3 : 6;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px]" style={{ maxHeight: '85vh', overflow: 'hidden' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Configurações — {PIPE_LABELS[pipeType]}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={defaultTab}>
          <TabsList className={`grid w-full grid-cols-${tabCount}`}>
            <TabsTrigger value="etapas" className="gap-1.5 text-xs">
              <Layers className="w-3.5 h-3.5" />
              Etapas
            </TabsTrigger>
            {isUpsellBase && (
              <TabsTrigger value="regras" className="gap-1.5 text-xs">
                <Clock className="w-3.5 h-3.5" />
                Regras
              </TabsTrigger>
            )}
            {isUpsell && (
              <TabsTrigger value="importar" className="gap-1.5 text-xs">
                <Upload className="w-3.5 h-3.5" />
                Importar
              </TabsTrigger>
            )}
            {!isUpsell && (
              <>
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
              </>
            )}
          </TabsList>

          <div className="overflow-y-auto mt-4 pr-1" style={{ maxHeight: 'calc(85vh - 10rem)' }}>
            <TabsContent value="etapas" className="mt-0">
              <ManagePipelineStagesContent
                pipelineType={pipeType}
                stages={stages}
              />
            </TabsContent>

            {isUpsellBase && (
              <TabsContent value="regras" className="mt-0">
                {upsellRulesSlot}
              </TabsContent>
            )}

            {isUpsell && (
              <TabsContent value="importar" className="mt-0">
                {upsellImportSlot}
              </TabsContent>
            )}

            {!isUpsell && (
              <>
                <TabsContent value="campos" className="mt-0">
                  <CustomFieldsManager />
                </TabsContent>

                <TabsContent value="distribuicao" className="mt-0">
                  <PipeDistributionSection pipeType={pipeType} />
                </TabsContent>

                <TabsContent value="importar" className="mt-0">
                  {destination && (
                    <ImportLeadsFunnelContent destination={destination} />
                  )}
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
              </>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
