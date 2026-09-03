import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Settings2,
  Layers,
  Type,
  Upload,
  FileDown,
  Send,
  Shuffle,
  Clock,
  Palette,
} from "lucide-react";
import { type StageFamily, type PipelineStage } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { usePipelines } from "@/modules/pipelines/hooks/model/usePipelines";
import { usePipelineDisplayConfig } from "../../hooks/config/usePipelineDisplayConfig";
import { type FunnelDestination } from "@/modules/leads";
import { ManagePipelineStagesContent } from "./ManagePipelineStagesModal";
import { CustomFieldsManager } from "@/modules/leads";
import { ImportLeadsFunnelContent } from "@/modules/leads";
import { ExportLeadsContent } from "@/modules/leads";
import { PipeDispatchRulesSection } from "./PipeDispatchRulesSection";
import { PipeDistributionSection } from "./PipeDistributionSection";
import { FunnelIdentitySection } from "./FunnelIdentitySection";
import type { ReactNode } from "react";
import { NOME_DE_FABRICA } from "@/contracts/pipe";

// StageFamily, não PipelineType: este diálogo também veste a Carteira (via
// slots) — as famílias upsell_* são resíduo D9, não funil (SCRUM-618).
// SCRUM-641: só a Carteira tem rótulo cravado aqui; funil de sistema é
// batizado pelo display_config (com NOME_DE_FABRICA de reserva), nunca pelo
// seed "Qualificação"/"Confirmação"/"Propostas".
const CARTEIRA_LABELS: Partial<Record<StageFamily, string>> = {
  upsell_base: "Carteira Base",
  upsell_gestao: "Carteira Gestão",
};

const PIPE_TO_DESTINATION: Partial<Record<StageFamily, FunnelDestination>> = {
  whatsapp: "qualificacao",
  confirmacao: "confirmacao",
  propostas: "propostas",
};

// Tailwind JIT só compila classe escrita por extenso — nada de template string.
const TAB_GRID: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  7: "grid-cols-7",
};

interface PipeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeType: StageFamily;
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
  /** Os três tipos que existem como linha em `pipeline_display_config`. */
  const isSystemPipe =
    pipeType === "whatsapp" || pipeType === "confirmacao" || pipeType === "propostas";

  // Linha canônica do funil em `pipelines` (626): afina o editor de etapas por
  // id e alimenta a aba Geral (identidade + Zona de Perigo). slug é único por
  // org; type=system desambigua funil custom homônimo.
  const { data: pipelines = [] } = usePipelines();
  const pipelineRow = isSystemPipe
    ? pipelines.find((p) => p.slug === pipeType && p.type === "system")
    : undefined;

  // Título com o nome que a ORG vê ("Oportunidades" ou o rename dela), não o
  // rótulo interno. display_name vence onde existir (precedência D4/636).
  const { data: displayConfigs = [] } = usePipelineDisplayConfig();
  const displayName = isSystemPipe
    ? displayConfigs.find((c) => c.pipe_type === pipeType)?.display_name
    : undefined;
  const titulo = isSystemPipe
    ? displayName || NOME_DE_FABRICA[pipeType] || pipeType
    : CARTEIRA_LABELS[pipeType] ?? pipeType;

  // upsell_base: Etapas + Regras + Importar (3 tabs). upsell_gestao: Etapas +
  // Importar (2 tabs). Sistema: 7 tabs (Geral entrou na SCRUM-636 — identidade
  // e exclusão no MESMO lugar do funil custom, para as duas telas nunca
  // discordarem sobre onde se renomeia ou se exclui um funil).
  const tabCount = isUpsellGestao ? 2 : isUpsellBase ? 3 : 7;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px]" style={{ maxHeight: '85vh', overflow: 'hidden' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Configurações — {titulo}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={defaultTab}>
          <TabsList className={`grid w-full ${TAB_GRID[tabCount]}`}>
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
                <TabsTrigger value="geral" className="gap-1.5 text-xs">
                  <Palette className="w-3.5 h-3.5" />
                  Geral
                </TabsTrigger>
              </>
            )}
          </TabsList>

          <div className="overflow-y-auto mt-4 pr-1" style={{ maxHeight: 'calc(85vh - 10rem)' }}>
            <TabsContent value="etapas" className="mt-0">
              <ManagePipelineStagesContent
                pipelineType={pipeType}
                pipelineId={pipelineRow?.id}
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

                {/* Identidade (nome/ícone/cor — D4) + Zona de Perigo (exclusão
                    via DeletePipelineDialog — D3). MESMO lugar, mesma copy e
                    mesmo portão de permissão do funil customizado: as duas
                    espécies deixaram de existir, então as duas telas não podem
                    discordar sobre onde se renomeia ou se exclui um funil.

                    Só os três tipos com linha em `pipelines`. upsell_* fica de
                    fora: resíduo D9, sem linha canônica e sem cards próprios. */}
                <TabsContent value="geral" className="mt-0">
                  {pipelineRow && (
                    <FunnelIdentitySection
                      pipeline={{
                        id: pipelineRow.id,
                        slug: pipelineRow.slug,
                        type: "system",
                        name: pipelineRow.name,
                        icon: pipelineRow.icon,
                        color: pipelineRow.color,
                      }}
                      displayName={displayName}
                      onDeleted={() => onOpenChange(false)}
                    />
                  )}
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
