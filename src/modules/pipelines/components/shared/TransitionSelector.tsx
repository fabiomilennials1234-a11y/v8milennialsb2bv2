import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCustomPipelines,
  useCustomPipelineStages as useCustomPipeStagesQuery,
} from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import { usePipelineStages, type PipelineType } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { usePipelineDisplayConfig } from "@/modules/pipelines/hooks/config/usePipelineDisplayConfig";
import { destinosDeSistema } from "@/contracts/pipe";

/** Pares de destino mutuamente exclusivos (custom XOR standard). */
export interface TransitionTarget {
  targetPipelineId: string | null;
  targetStageId: string | null;
  targetPipeType: string | null;
  targetStageKey: string | null;
}

// SCRUM-618 (D9/ADR-0034): Carteira saiu das opções de destino — o funil dela
// está aposentado (20270805000010) e as etapas-alvo não existem mais como
// funil. Medido em prod (2026-09-01): 1 etapa custom ainda aponta
// target_pipe_type='upsell_base'; a EXECUÇÃO dessa transição segue intacta
// (useCustomPipelines), só não dá mais para criar/editar apontando pra lá.
//
// SCRUM-641: o catálogo fixo ("Qualificação"/"Confirmação"/"Propostas") saiu
// também — as opções padrão agora vêm de `pipeline_display_config`, com o
// NOME que a org usa, e só para os funis que ela TEM e não escondeu. Apontar
// transição para funil que a org excluiu criaria movimento para lugar nenhum.

/**
 * Seletor de transição automática ao atingir etapa de sucesso. Lista unificada:
 * pipes padrão + funis customizados da org. Grava no par de colunas correto
 * (custom → pipeline_id/stage_id; standard → pipe_type/stage_key).
 *
 * Reutilizado por funis customizados (`CustomPipeSettingsDialog`) e pipes
 * padrão (`ManagePipelineStagesModal`). Exclusão do funil de origem:
 * - `currentPipelineId` exclui um funil customizado (origem custom)
 * - `currentPipeType`   exclui um pipe padrão (origem standard)
 */
export function TransitionSelector({
  targetPipelineId,
  targetStageId,
  targetPipeType,
  targetStageKey,
  currentPipelineId,
  currentPipeType,
  onChangeTarget,
}: TransitionTarget & {
  currentPipelineId?: string;
  currentPipeType?: string;
  onChangeTarget: (updates: TransitionTarget) => void;
}) {
  const { data: customPipelines } = useCustomPipelines();
  const { data: displayConfigs } = usePipelineDisplayConfig();
  const isCustomTarget = !!targetPipelineId;
  const isStandardTarget = !!targetPipeType;
  const selectedPipeValue = isCustomTarget ? targetPipelineId : isStandardTarget ? targetPipeType : "__none__";

  // Load stages for selected target
  const { data: customTargetStages } = useCustomPipeStagesQuery(isCustomTarget ? targetPipelineId : undefined);
  const { data: standardTargetStages } = usePipelineStages(
    isStandardTarget ? (targetPipeType as PipelineType) : "whatsapp"
  );

  const targetStages = isCustomTarget
    ? (customTargetStages || []).filter((s) => s.is_active).map((s) => ({ key: s.id, name: s.name, color: s.color }))
    : isStandardTarget
    ? (standardTargetStages || []).filter((s) => s.is_active).map((s) => ({ key: s.stage_key, name: s.name, color: s.color }))
    : [];

  const selectedStageValue = isCustomTarget ? targetStageId : isStandardTarget ? targetStageKey : "";

  const handlePipeChange = (value: string) => {
    if (value === "__none__") {
      onChangeTarget({ targetPipelineId: null, targetStageId: null, targetPipeType: null, targetStageKey: null });
      return;
    }
    const isCustom = customPipelines?.some((p) => p.id === value);
    if (isCustom) {
      onChangeTarget({ targetPipelineId: value, targetStageId: null, targetPipeType: null, targetStageKey: null });
    } else {
      onChangeTarget({ targetPipelineId: null, targetStageId: null, targetPipeType: value, targetStageKey: null });
    }
  };

  const handleStageChange = (value: string) => {
    if (isCustomTarget) {
      onChangeTarget({ targetPipelineId, targetStageId: value, targetPipeType: null, targetStageKey: null });
    } else if (isStandardTarget) {
      onChangeTarget({ targetPipelineId: null, targetStageId: null, targetPipeType, targetStageKey: value });
    }
  };

  // Exclude the origin funnel from destination options.
  const standardOptions = destinosDeSistema(displayConfigs)
    .map((d) => ({ value: d.pipeType, label: d.label }))
    .filter((p) => p.value !== currentPipeType);
  const otherCustomPipelines = (customPipelines || []).filter((p) => p.id !== currentPipelineId);

  return (
    <div className="space-y-2 mt-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
      <Label className="text-xs font-medium text-green-700 dark:text-green-300">
        Ao chegar nesta etapa, mover lead para:
      </Label>
      <Select value={selectedPipeValue || "__none__"} onValueChange={handlePipeChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Nenhum (ficar neste funil)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Nenhum (ficar neste funil)</SelectItem>
          {standardOptions.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                Funis do sistema
              </SelectLabel>
              {standardOptions.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectGroup>
          )}
          {/* Alvo gravado num funil que a org não tem mais: manter o item
              visível (fallback honesto) em vez de deixar o Radix cair no
              placeholder e a tela negar um vínculo que está no banco. */}
          {isStandardTarget &&
            targetPipeType &&
            !standardOptions.some((p) => p.value === targetPipeType) && (
              <SelectItem value={targetPipeType}>Funil removido</SelectItem>
            )}
          {otherCustomPipelines.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                Pipes Custom
              </SelectLabel>
              {otherCustomPipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>

      {(isCustomTarget || isStandardTarget) && targetStages.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Etapa destino</Label>
          <Select value={selectedStageValue || ""} onValueChange={handleStageChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecione a etapa" />
            </SelectTrigger>
            <SelectContent>
              {targetStages.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || "#888" }} />
                    {s.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
