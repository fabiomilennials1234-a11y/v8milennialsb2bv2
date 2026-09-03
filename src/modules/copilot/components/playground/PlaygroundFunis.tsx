/**
 * PlaygroundFunis — Tab de Funis no CopilotPlayground
 *
 * Mostra pipes padrao + custom, stages como checkboxes,
 * e move rules inline por stage selecionada.
 */

import { useState, useCallback } from "react";
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import { usePipeTypeOptions } from "../../hooks/usePipeTypeOptions";
import { useAllPipelineStageOptions, useCustomPipelines, useCustomPipelineStages } from "@/modules/pipelines";

import {
  FUNIS_CONDITIONS,
  type FunisState,
  type FunisMoveRule,
  type FunisCondition,
} from "./funis-mapping";

// ── Props ──

interface PlaygroundFunisProps {
  state: FunisState;
  onChange: (state: FunisState) => void;
}

// ── Sub-component: Custom pipe stages (hook call isolation) ──

function CustomPipeStagesSection({
  pipelineId,
  selectedStages,
  onToggleStage,
  onSelectAll,
  onClearAll,
}: {
  pipelineId: string;
  selectedStages: string[];
  onToggleStage: (stage: string) => void;
  onSelectAll: (stages: string[]) => void;
  onClearAll: () => void;
}) {
  const { data: stages = [] } = useCustomPipelineStages(pipelineId);

  if (stages.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        Nenhuma etapa configurada neste funil.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <Label className="text-xs text-muted-foreground">Etapas:</Label>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => onSelectAll(stages.map((s) => s.stage_key))}
          >
            Todas
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={onClearAll}
          >
            Limpar
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
        {stages.map((stage) => (
          <div key={stage.stage_key} className="flex items-center gap-1.5">
            <Checkbox
              id={`custom-${pipelineId}-${stage.stage_key}`}
              checked={selectedStages.includes(stage.stage_key)}
              onCheckedChange={() => onToggleStage(stage.stage_key)}
            />
            <Label
              htmlFor={`custom-${pipelineId}-${stage.stage_key}`}
              className="text-xs cursor-pointer"
            >
              {stage.name}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helper: collect all stages across pipes for move-rule target dropdown ──

function useAllStagesFlat() {
  const { stagesByPipe } = useAllPipelineStageOptions();
  const pipeTypeOptions = usePipeTypeOptions();
  const flat: { pipe: string; stage: string; label: string; pipeLabel: string }[] = [];

  for (const pipeType of pipeTypeOptions) {
    const stages = stagesByPipe[pipeType.value] || [];
    for (const s of stages) {
      flat.push({
        pipe: pipeType.value,
        stage: s.value,
        label: s.label,
        pipeLabel: pipeType.label,
      });
    }
  }

  return flat;
}

// ── Main component ──

export function PlaygroundFunis({ state, onChange }: PlaygroundFunisProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { stagesByPipe } = useAllPipelineStageOptions();
  const pipeTypeOptions = usePipeTypeOptions();
  const { data: customPipelines = [] } = useCustomPipelines();
  const allStages = useAllStagesFlat();

  // ── Handlers ──

  const togglePipe = useCallback(
    (pipeValue: string) => {
      const isActive = state.activePipes.includes(pipeValue);
      if (isActive) {
        const newStages = { ...state.activeStages };
        delete newStages[pipeValue];
        onChange({
          ...state,
          activePipes: state.activePipes.filter((p) => p !== pipeValue),
          activeStages: newStages,
          moveRules: state.moveRules.filter(
            (r) => r.fromPipe !== pipeValue && r.toPipe !== pipeValue
          ),
        });
      } else {
        setExpanded((prev) => ({ ...prev, [pipeValue]: true }));
        onChange({
          ...state,
          activePipes: [...state.activePipes, pipeValue],
        });
      }
    },
    [state, onChange]
  );

  const toggleStage = useCallback(
    (pipe: string, stage: string) => {
      const current = state.activeStages[pipe] || [];
      const has = current.includes(stage);
      const newStages = has
        ? current.filter((s) => s !== stage)
        : [...current, stage];

      onChange({
        ...state,
        activeStages: { ...state.activeStages, [pipe]: newStages },
        // Remove move rules for deselected stage
        moveRules: has
          ? state.moveRules.filter(
              (r) => !(r.fromPipe === pipe && r.fromStage === stage)
            )
          : state.moveRules,
      });
    },
    [state, onChange]
  );

  const selectAllStages = useCallback(
    (pipe: string, stages: string[]) => {
      onChange({
        ...state,
        activeStages: { ...state.activeStages, [pipe]: stages },
      });
    },
    [state, onChange]
  );

  const clearAllStages = useCallback(
    (pipe: string) => {
      onChange({
        ...state,
        activeStages: { ...state.activeStages, [pipe]: [] },
        moveRules: state.moveRules.filter((r) => r.fromPipe !== pipe),
      });
    },
    [state, onChange]
  );

  const addMoveRule = useCallback(() => {
    const firstPipe = state.activePipes[0];
    const firstStage = state.activeStages[firstPipe]?.[0] || "";
    const newRule: FunisMoveRule = {
      fromPipe: firstPipe || "",
      fromStage: firstStage,
      condition: "qualification_met",
      toPipe: firstPipe || "",
      toStage: "",
    };
    onChange({ ...state, moveRules: [...state.moveRules, newRule] });
  }, [state, onChange]);

  const updateMoveRule = useCallback(
    (index: number, patch: Partial<FunisMoveRule>) => {
      const rules = [...state.moveRules];
      rules[index] = { ...rules[index], ...patch };
      onChange({ ...state, moveRules: rules });
    },
    [state, onChange]
  );

  const removeMoveRule = useCallback(
    (index: number) => {
      onChange({
        ...state,
        moveRules: state.moveRules.filter((_, i) => i !== index),
      });
    },
    [state, onChange]
  );

  // ── Render ──

  const activeCount = state.activePipes.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold">Funis & Etapas</h3>
          {activeCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {activeCount} ativo{activeCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Selecione em quais funis e etapas o agente deve atuar. Configure regras
        de movimentacao para mover leads automaticamente entre etapas.
      </p>

      {/* Standard pipes */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Funis</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {pipeTypeOptions.map((pipe) => {
            const isActive = state.activePipes.includes(pipe.value);
            const isExpanded = expanded[pipe.value] ?? false;
            const pipeStages = state.activeStages[pipe.value] || [];
            const stagesForPipe = stagesByPipe[pipe.value] || [];

            return (
              <Collapsible
                key={pipe.value}
                open={isActive && isExpanded}
                onOpenChange={(open) =>
                  setExpanded((prev) => ({ ...prev, [pipe.value]: open }))
                }
              >
                <div
                  className={`flex items-center justify-between p-2.5 rounded-md border transition-colors ${
                    isActive
                      ? "bg-primary/5 border-primary/20"
                      : "hover:bg-muted/50 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      checked={isActive}
                      onCheckedChange={() => togglePipe(pipe.value)}
                    />
                    <span className="text-sm font-medium">{pipe.label}</span>
                    {isActive && pipeStages.length > 0 && (
                      <Badge variant="outline" className="text-[10px] h-5">
                        {pipeStages.length} etapa{pipeStages.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  {isActive && stagesForPipe.length > 0 && (
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  )}
                </div>

                <CollapsibleContent>
                  <div className="ml-8 mt-1 mb-2 space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs text-muted-foreground">
                        Etapas:
                      </Label>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() =>
                            selectAllStages(
                              pipe.value,
                              stagesForPipe.map((s) => s.value)
                            )
                          }
                        >
                          Todas
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => clearAllStages(pipe.value)}
                        >
                          Limpar
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                      {stagesForPipe.map((stage) => (
                        <div
                          key={stage.value}
                          className="flex items-center gap-1.5"
                        >
                          <Checkbox
                            id={`std-${pipe.value}-${stage.value}`}
                            checked={pipeStages.includes(stage.value)}
                            onCheckedChange={() =>
                              toggleStage(pipe.value, stage.value)
                            }
                          />
                          <Label
                            htmlFor={`std-${pipe.value}-${stage.value}`}
                            className="text-xs cursor-pointer"
                          >
                            {stage.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
          {/* Os funis criados pela org entram na MESMA caixa e na mesma
              lista. Tinham um Card próprio, com título "Funis Custom" e um
              selo "Custom" em cada linha — três marcas de espécie para uma
              escolha que só depende do nome do funil. */}
          {customPipelines.map((pipeline) => {
              const isActive = state.activePipes.includes(pipeline.id);
              const isExpanded = expanded[pipeline.id] ?? false;
              const pipeStages = state.activeStages[pipeline.id] || [];

              return (
                <Collapsible
                  key={pipeline.id}
                  open={isActive && isExpanded}
                  onOpenChange={(open) =>
                    setExpanded((prev) => ({ ...prev, [pipeline.id]: open }))
                  }
                >
                  <div
                    className={`flex items-center justify-between p-2.5 rounded-md border transition-colors ${
                      isActive
                        ? "bg-primary/5 border-primary/20"
                        : "hover:bg-muted/50 border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        checked={isActive}
                        onCheckedChange={() => togglePipe(pipeline.id)}
                      />
                      <span className="text-sm font-medium">
                        {pipeline.name}
                      </span>
                      {isActive && pipeStages.length > 0 && (
                        <Badge variant="outline" className="text-[10px] h-5">
                          {pipeStages.length} etapa
                          {pipeStages.length !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    {isActive && (
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                    )}
                  </div>

                  <CollapsibleContent>
                    <div className="ml-8 mt-1 mb-2">
                      <CustomPipeStagesSection
                        pipelineId={pipeline.id}
                        selectedStages={pipeStages}
                        onToggleStage={(stage) =>
                          toggleStage(pipeline.id, stage)
                        }
                        onSelectAll={(stages) =>
                          selectAllStages(pipeline.id, stages)
                        }
                        onClearAll={() => clearAllStages(pipeline.id)}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
        </CardContent>
      </Card>

      {/* Move Rules */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Regras de Movimentacao</CardTitle>
          <CardDescription className="text-xs">
            Quando uma condicao for atendida, mova o lead automaticamente
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {state.moveRules.map((rule, idx) => (
            <MoveRuleRow
              key={idx}
              rule={rule}
              allStages={allStages}
              activePipes={state.activePipes}
              activeStages={state.activeStages}
              onChange={(patch) => updateMoveRule(idx, patch)}
              onRemove={() => removeMoveRule(idx)}
            />
          ))}

          {state.activePipes.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs"
              onClick={addMoveRule}
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar regra
            </Button>
          )}

          {state.activePipes.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Selecione pelo menos um funil para criar regras.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Move Rule Row ──

function MoveRuleRow({
  rule,
  allStages,
  activePipes,
  activeStages,
  onChange,
  onRemove,
}: {
  rule: FunisMoveRule;
  allStages: { pipe: string; stage: string; label: string; pipeLabel: string }[];
  activePipes: string[];
  activeStages: Record<string, string[]>;
  onChange: (patch: Partial<FunisMoveRule>) => void;
  onRemove: () => void;
}) {
  // Build from-stage options: only selected stages in active pipes
  const fromOptions: { pipe: string; stage: string; label: string }[] = [];
  for (const pipe of activePipes) {
    const stages = activeStages[pipe] || [];
    for (const stage of stages) {
      const match = allStages.find(
        (s) => s.pipe === pipe && s.stage === stage
      );
      fromOptions.push({
        pipe,
        stage,
        label: match ? `${match.pipeLabel} > ${match.label}` : `${pipe} > ${stage}`,
      });
    }
  }

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-md border bg-muted/30">
      <div className="flex-1 space-y-2">
        {/* From */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-10 shrink-0">
            De:
          </span>
          <Select
            value={`${rule.fromPipe}::${rule.fromStage}`}
            onValueChange={(v) => {
              const [pipe, stage] = v.split("::");
              onChange({ fromPipe: pipe, fromStage: stage });
            }}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Origem" />
            </SelectTrigger>
            <SelectContent>
              {fromOptions.map((o) => (
                <SelectItem
                  key={`${o.pipe}::${o.stage}`}
                  value={`${o.pipe}::${o.stage}`}
                >
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Condition */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-10 shrink-0">
            Quando:
          </span>
          <Select
            value={rule.condition}
            onValueChange={(v) =>
              onChange({ condition: v as FunisCondition })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FUNIS_CONDITIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* To */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-10 shrink-0">
            Para:
          </span>
          <Select
            value={`${rule.toPipe}::${rule.toStage}`}
            onValueChange={(v) => {
              const [pipe, stage] = v.split("::");
              onChange({ toPipe: pipe, toStage: stage });
            }}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Destino" />
            </SelectTrigger>
            <SelectContent>
              {allStages.map((s) => (
                <SelectItem
                  key={`${s.pipe}::${s.stage}`}
                  value={`${s.pipe}::${s.stage}`}
                >
                  {s.pipeLabel} &gt; {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
