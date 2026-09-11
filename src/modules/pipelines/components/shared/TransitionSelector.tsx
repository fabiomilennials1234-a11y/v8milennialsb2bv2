import { isPipelineVisible, sortPipelinesForNavigation } from "@/modules/pipelines/lib/pipeline-navigation";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFunisDaOrg } from "@/modules/pipelines/hooks/model/useFunisDaOrg";
import { useEtapasDoFunil } from "@/modules/pipelines/hooks/model/useEtapasDoFunil";

/**
 * `targetPipeType`/`targetStageKey` existem apenas para ler configurações
 * antigas. Toda nova escolha grava os UUIDs canônicos.
 */
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
// SCRUM-641: o catálogo fixo ("Qualificação"/"Confirmação"/"Propostas") saiu.
// As opções vêm do registro canônico e são exibidas pelo nome escolhido.

/**
 * Seletor de transição automática ao atingir etapa de sucesso. Todos os funis
 * vêm do mesmo registro e toda escolha grava `pipeline_id` + `stage_id`.
 *
 * Reutilizado pelos editores existentes. `currentPipeType` permanece apenas
 * para reconhecer configurações antigas enquanto elas são migradas para UUID.
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
  const { data: pipelines } = useFunisDaOrg();
  const legacyPipeline = targetPipeType
    ? pipelines.find((p) => p.slug === targetPipeType)
    : undefined;
  const resolvedTargetPipelineId = targetPipelineId || legacyPipeline?.id || null;
  const selectedPipeValue = resolvedTargetPipelineId || "__none__";
  const { etapas } = useEtapasDoFunil(resolvedTargetPipelineId);
  const selectedStageValue =
    targetStageId || etapas.find((stage) => stage.stageKey === targetStageKey)?.id || "";

  const handlePipeChange = (value: string) => {
    if (value === "__none__") {
      onChangeTarget({ targetPipelineId: null, targetStageId: null, targetPipeType: null, targetStageKey: null });
      return;
    }
    onChangeTarget({ targetPipelineId: value, targetStageId: null, targetPipeType: null, targetStageKey: null });
  };

  const handleStageChange = (value: string) => {
    if (!resolvedTargetPipelineId) return;
    onChangeTarget({
      targetPipelineId: resolvedTargetPipelineId,
      targetStageId: value,
      targetPipeType: null,
      targetStageKey: null,
    });
  };

  const options = sortPipelinesForNavigation(pipelines).filter(
    (p) =>
      p.is_active !== false && isPipelineVisible(p) &&
      p.id !== currentPipelineId &&
      (!currentPipeType || p.slug !== currentPipeType),
  );

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
          {options.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
          ))}
          {/* Alvo gravado num funil que a org não tem mais: manter o item
              visível (fallback honesto) em vez de deixar o Radix cair no
              placeholder e a tela negar um vínculo que está no banco. */}
          {resolvedTargetPipelineId && !options.some((p) => p.id === resolvedTargetPipelineId) && (
            <SelectItem value={resolvedTargetPipelineId} disabled>{pipelines.find((p) => p.id === resolvedTargetPipelineId)?.label ?? "Funil removido"}</SelectItem>
          )}
        </SelectContent>
      </Select>

      {resolvedTargetPipelineId && etapas.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Etapa destino</Label>
          <Select value={selectedStageValue || ""} onValueChange={handleStageChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecione a etapa" />
            </SelectTrigger>
            <SelectContent>
              {etapas.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-2">
                    {s.label}
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
