/**
 * Step: Revisão de Kanban Rules (Multi-funil)
 *
 * O usuário seleciona quais funis o agente vai atender.
 * Para cada funil selecionado, as etapas reais são carregadas do banco
 * e o usuário pode definir goal/behavior para cada etapa.
 * Etapas podem ser desabilitadas (toggle) sem serem removidas.
 */

import { useState, useMemo, useCallback } from "react";
import { useFormContext } from "react-hook-form";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { KanbanSquare, ChevronDown, ChevronUp } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { CopilotWizardData } from "@/types/copilot";
import {
  usePipelineStages,
  getPipelineTypeName,
  type PipelineType,
} from "@/hooks/usePipelineStages";

const ALL_PIPE_TYPES: PipelineType[] = [
  "whatsapp",
  "confirmacao",
  "propostas",
  "upsell_base",
  "upsell_gestao",
];

export function KanbanRulesReviewStep() {
  const { watch, setValue, getValues } = useFormContext<CopilotWizardData>();
  const kanbanRules = watch("kanbanRules") || [];

  // Fetch stages for all built-in pipes
  const whatsapp = usePipelineStages("whatsapp");
  const confirmacao = usePipelineStages("confirmacao");
  const propostas = usePipelineStages("propostas");
  const upsellBase = usePipelineStages("upsell_base");
  const upsellGestao = usePipelineStages("upsell_gestao");

  const stagesByPipe = useMemo(() => {
    const toStages = (data: unknown[] | undefined) =>
      (data || []).map((s: any) => ({
        key: s.stage_key || s.id,
        name: s.name,
      }));

    return {
      whatsapp: toStages(whatsapp.data),
      confirmacao: toStages(confirmacao.data),
      propostas: toStages(propostas.data),
      upsell_base: toStages(upsellBase.data),
      upsell_gestao: toStages(upsellGestao.data),
    } as Record<string, Array<{ key: string; name: string }>>;
  }, [
    whatsapp.data,
    confirmacao.data,
    propostas.data,
    upsellBase.data,
    upsellGestao.data,
  ]);

  // Determine which pipes are currently selected (have rules in form)
  const selectedPipes = useMemo(() => {
    const pipes = new Set<string>();
    kanbanRules.forEach((rule: any) => {
      if (rule.pipeType) pipes.add(rule.pipeType);
    });
    return pipes;
  }, [kanbanRules]);

  // Track which sections are expanded
  const [expandedPipes, setExpandedPipes] = useState<Set<string>>(
    () => new Set(selectedPipes)
  );

  // Toggle a pipe on/off
  const togglePipe = useCallback(
    (pipeType: string) => {
      const currentRules = getValues("kanbanRules") || [];

      if (selectedPipes.has(pipeType)) {
        // Remove all rules for this pipe
        const filtered = currentRules.filter(
          (r: any) => r.pipeType !== pipeType
        );
        setValue("kanbanRules", filtered, { shouldDirty: true });
        setExpandedPipes((prev) => {
          const next = new Set(prev);
          next.delete(pipeType);
          return next;
        });
      } else {
        // Add empty rules for each stage of this pipe
        const stages = stagesByPipe[pipeType] || [];
        const newRules = stages.map((stage) => ({
          pipeType,
          stageName: stage.key,
          goal: "",
          behavior: "",
          allowedActions: [] as string[],
          forbiddenActions: [] as string[],
        }));
        setValue("kanbanRules", [...currentRules, ...newRules], {
          shouldDirty: true,
        });
        setExpandedPipes((prev) => new Set([...prev, pipeType]));
      }
    },
    [selectedPipes, getValues, setValue, stagesByPipe]
  );

  // Toggle expand/collapse
  const toggleExpanded = useCallback((pipeType: string) => {
    setExpandedPipes((prev) => {
      const next = new Set(prev);
      if (next.has(pipeType)) {
        next.delete(pipeType);
      } else {
        next.add(pipeType);
      }
      return next;
    });
  }, []);

  // Update a specific rule's field
  const updateRule = useCallback(
    (
      pipeType: string,
      stageName: string,
      field: "goal" | "behavior",
      value: string
    ) => {
      const currentRules = getValues("kanbanRules") || [];
      const updated = currentRules.map((r: any) => {
        if (r.pipeType === pipeType && r.stageName === stageName) {
          return { ...r, [field]: value };
        }
        return r;
      });
      setValue("kanbanRules", updated, { shouldDirty: true });
    },
    [getValues, setValue]
  );

  // Toggle a single stage disabled
  const toggleStageDisabled = useCallback(
    (pipeType: string, stageName: string) => {
      const currentRules = getValues("kanbanRules") || [];
      const updated = currentRules.map((r: any) => {
        if (r.pipeType === pipeType && r.stageName === stageName) {
          return { ...r, _disabled: !r._disabled };
        }
        return r;
      });
      setValue("kanbanRules", updated, { shouldDirty: true });
    },
    [getValues, setValue]
  );

  // Get rules for a specific pipe, ordered by stage position
  const getRulesForPipe = useCallback(
    (pipeType: string) => {
      const pipeRules = kanbanRules.filter(
        (r: any) => r.pipeType === pipeType
      );
      const stages = stagesByPipe[pipeType] || [];
      return pipeRules.sort((a: any, b: any) => {
        const aIdx = stages.findIndex((s) => s.key === a.stageName);
        const bIdx = stages.findIndex((s) => s.key === b.stageName);
        return aIdx - bIdx;
      });
    },
    [kanbanRules, stagesByPipe]
  );

  // Get stage display name
  const getStageName = useCallback(
    (pipeType: string, stageKey: string) => {
      const stages = stagesByPipe[pipeType] || [];
      const stage = stages.find((s) => s.key === stageKey);
      return stage?.name || stageKey.replace(/_/g, " ");
    },
    [stagesByPipe]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <KanbanSquare className="w-6 h-6 text-primary" />
          Regras do Kanban
        </h2>
        <p className="text-muted-foreground">
          Selecione os funis que este agente vai atender e defina o
          comportamento em cada etapa.
        </p>
      </div>

      {/* Pipe selector */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {ALL_PIPE_TYPES.map((pipeType) => {
          const isSelected = selectedPipes.has(pipeType);
          const stageCount = stagesByPipe[pipeType]?.length || 0;

          return (
            <button
              key={pipeType}
              type="button"
              onClick={() => togglePipe(pipeType)}
              className={`flex items-center gap-2 p-3 rounded-lg border text-left text-sm transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-input hover:bg-muted/50"
              }`}
            >
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                  isSelected
                    ? "bg-primary border-primary"
                    : "border-muted-foreground/30"
                }`}
              >
                {isSelected && (
                  <svg
                    className="w-3 h-3 text-primary-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
              <div>
                <span className="font-medium">
                  {getPipelineTypeName(pipeType)}
                </span>
                <span className="text-xs text-muted-foreground ml-1">
                  ({stageCount} etapas)
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Rules by pipe */}
      {selectedPipes.size === 0 ? (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground">
            Selecione ao menos um funil acima para configurar as regras.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {ALL_PIPE_TYPES.filter((p) => selectedPipes.has(p)).map(
            (pipeType) => {
              const isExpanded = expandedPipes.has(pipeType);
              const pipeRules = getRulesForPipe(pipeType);
              const activeCount = pipeRules.filter(
                (r: any) => !r._disabled
              ).length;

              return (
                <Collapsible
                  key={pipeType}
                  open={isExpanded}
                  onOpenChange={() => toggleExpanded(pipeType)}
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {getPipelineTypeName(pipeType)}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {activeCount} de {pipeRules.length} etapas ativas
                        </span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="space-y-3 pt-3">
                    {pipeRules.map((rule: any) => {
                      const isDisabled = rule._disabled === true;

                      return (
                        <Card
                          key={`${rule.pipeType}-${rule.stageName}`}
                          className={`p-4 transition-opacity ${
                            isDisabled ? "opacity-50" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <span className="font-semibold text-sm">
                              {getStageName(pipeType, rule.stageName)}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {isDisabled ? "Inativo" : "Ativo"}
                              </span>
                              <Switch
                                checked={!isDisabled}
                                onCheckedChange={() =>
                                  toggleStageDisabled(pipeType, rule.stageName)
                                }
                              />
                            </div>
                          </div>

                          {!isDisabled && (
                            <div className="space-y-3">
                              <div>
                                <label className="text-xs font-medium text-muted-foreground">
                                  Objetivo da etapa
                                </label>
                                <Textarea
                                  rows={2}
                                  placeholder="O que o agente deve alcançar nesta etapa?"
                                  value={rule.goal || ""}
                                  onChange={(e) =>
                                    updateRule(
                                      pipeType,
                                      rule.stageName,
                                      "goal",
                                      e.target.value
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-muted-foreground">
                                  Comportamento esperado
                                </label>
                                <Textarea
                                  rows={2}
                                  placeholder="Como o agente deve se comportar aqui?"
                                  value={rule.behavior || ""}
                                  onChange={(e) =>
                                    updateRule(
                                      pipeType,
                                      rule.stageName,
                                      "behavior",
                                      e.target.value
                                    )
                                  }
                                />
                              </div>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              );
            }
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        As regras por etapa definem como o agente se comporta em cada fase do
        funil. Etapas inativas serão ignoradas pelo agente.
      </p>
    </div>
  );
}
