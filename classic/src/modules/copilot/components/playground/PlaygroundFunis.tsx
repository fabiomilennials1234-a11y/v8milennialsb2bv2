/**
 * PlaygroundFunis — Tab de Funis no CopilotPlayground
 *
 * Mostra todos os funis ativos e suas etapas como checkboxes.
 */

import { useState, useCallback } from "react";
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import { useCopilotFunnelOptions } from "../../hooks/usePipeTypeOptions";

import { type FunisState } from "./funis-mapping";

// ── Props ──

interface PlaygroundFunisProps {
  state: FunisState;
  onChange: (state: FunisState) => void;
}

// ── Main component ──

export function PlaygroundFunis({ state, onChange }: PlaygroundFunisProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { options: pipeTypeOptions, stagesByPipe } = useCopilotFunnelOptions({
    incluirCampanha: false,
  });

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
        Selecione em quais funis e etapas o agente deve atuar.
      </p>

      {/* Todos os funis usam o mesmo catálogo e a mesma renderização. */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Funis</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {pipeTypeOptions.filter((pipe) => pipe.isVisible !== false || state.activePipes.includes(pipe.value)).map((pipe) => {
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
        </CardContent>
      </Card>

    </div>
  );
}
