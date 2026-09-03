/**
 * PlaygroundFollowup — Follow-up rules management tab for the Copilot Playground.
 *
 * Extends the existing AgentFollowupRulesTab patterns with:
 * - All 5 trigger types (no_response, after_qualification, after_meeting_scheduled, post_sale, proposal_no_response)
 * - Cadence mode toggle: single-shot (default) vs multi-step sequence
 * - Step editor with visual connecting lines
 *
 * Uses existing CRUD hooks from useAgentFollowupRules.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  Filter,
  MessageSquare,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Zap,
  Calendar,
  Info,
  Loader2,
  Save,
  GripVertical,
  ListOrdered,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FollowupRule, FollowupTriggerType, FollowupStyle, SequenceStep } from "@/types/copilot";
import { usePipeTypeOptions } from "../../hooks/usePipeTypeOptions";
import { useAllPipelineStageOptions } from "@/modules/pipelines";
import {
  useAgentFollowupRules,
  useCreateFollowupRule,
  useUpdateFollowupRule,
  useDeleteFollowupRule,
  useToggleFollowupRule,
} from "@/modules/copilot/hooks/useAgentFollowupRules";

// =====================================================
// CONSTANTS
// =====================================================

const FOLLOWUP_STYLES: Array<{ value: FollowupStyle; label: string; description: string }> = [
  { value: "direct", label: "Direto", description: "Pergunta direta sobre o assunto anterior" },
  { value: "value", label: "Valor", description: "Agrega valor com conteudo relevante" },
  { value: "curiosity", label: "Curiosidade", description: "Gera curiosidade com novidade" },
  { value: "breakup", label: "Breakup", description: "Ultima tentativa antes de parar" },
];

const TRIGGER_TYPES: Array<{ value: FollowupTriggerType; label: string }> = [
  { value: "no_response", label: "Sem resposta" },
  { value: "after_qualification", label: "Apos qualificacao" },
  { value: "after_meeting_scheduled", label: "Apos reuniao agendada" },
  { value: "post_sale", label: "Pos-venda" },
  { value: "proposal_no_response", label: "Proposta sem resposta" },
];

const DAYS_OF_WEEK = [
  { value: "seg", label: "Seg" },
  { value: "ter", label: "Ter" },
  { value: "qua", label: "Qua" },
  { value: "qui", label: "Qui" },
  { value: "sex", label: "Sex" },
  { value: "sab", label: "Sab" },
  { value: "dom", label: "Dom" },
];

const DEFAULT_RULE: Partial<FollowupRule> = {
  name: "",
  description: "",
  isActive: true,
  priority: 0,
  triggerType: "no_response",
  triggerDelayHours: 24,
  triggerDelayMinutes: 0,
  maxFollowups: 3,
  filterTags: [],
  filterTagsExclude: [],
  filterOrigins: [],
  filterPipes: [],
  filterStages: [],
  filterCustomFields: [],
  useLastContext: true,
  contextLookbackDays: 30,
  followupStyle: "direct",
  messageTemplate: "",
  sendOnlyBusinessHours: true,
  businessHoursStart: "09:00",
  businessHoursEnd: "18:00",
  sendDays: ["seg", "ter", "qua", "qui", "sex"],
  timezone: "America/Sao_Paulo",
};

const DEFAULT_STEP: SequenceStep = {
  order: 1,
  delayHours: 24,
  delayMinutes: 0,
  style: "direct",
};

// =====================================================
// STEP EDITOR
// =====================================================

function StepEditor({
  step,
  index,
  onUpdate,
  onRemove,
  isOnly,
}: {
  step: SequenceStep;
  index: number;
  onUpdate: (updates: Partial<SequenceStep>) => void;
  onRemove: () => void;
  isOnly: boolean;
}) {
  return (
    <div className="relative flex gap-3 items-start">
      {/* Vertical connector line */}
      <div className="flex flex-col items-center pt-3">
        <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-xs font-bold text-primary shrink-0">
          {step.order}
        </div>
        <div className="w-px flex-1 bg-border mt-1" />
      </div>

      <div className="flex-1 space-y-3 pb-4 border-b border-dashed last:border-b-0 last:pb-0">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Horas</Label>
            <Input
              type="number"
              min={0}
              value={step.delayHours}
              onChange={(e) => onUpdate({ delayHours: parseInt(e.target.value) || 0 })}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Minutos</Label>
            <Input
              type="number"
              min={0}
              max={59}
              value={step.delayMinutes}
              onChange={(e) => onUpdate({ delayMinutes: parseInt(e.target.value) || 0 })}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Estilo</Label>
            <Select
              value={step.style}
              onValueChange={(v) => onUpdate({ style: v as FollowupStyle })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOLLOWUP_STYLES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Template (opcional)</Label>
            <Textarea
              value={step.messageTemplate || ""}
              onChange={(e) => onUpdate({ messageTemplate: e.target.value || undefined })}
              placeholder="Deixe vazio para gerar automaticamente"
              rows={2}
              className="text-sm resize-none"
            />
          </div>
          {!isOnly && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onRemove}
            >
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================
// RULE CARD
// =====================================================

function FollowupRuleCard({
  rule,
  index,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onDelete,
  onToggleActive,
  isSaving,
}: {
  rule: FollowupRule;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (updates: Partial<FollowupRule>) => void;
  onDelete: () => void;
  onToggleActive: (isActive: boolean) => void;
  isSaving: boolean;
}) {
  const [localRule, setLocalRule] = useState(rule);
  const [tagInput, setTagInput] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const { stagesByPipe } = useAllPipelineStageOptions();
  const pipeTypeOptions = usePipeTypeOptions();

  const isCadenceMode = !!(localRule.sequenceSteps && localRule.sequenceSteps.length > 0);

  const updateLocalRule = (field: string, value: unknown) => {
    setLocalRule((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    onUpdate(localRule);
    setHasChanges(false);
  };

  const toggleCadenceMode = (enabled: boolean) => {
    if (enabled) {
      updateLocalRule("sequenceSteps", [
        { ...DEFAULT_STEP, order: 1, delayHours: localRule.triggerDelayHours, style: localRule.followupStyle },
      ]);
    } else {
      updateLocalRule("sequenceSteps", undefined);
    }
  };

  const addStep = () => {
    const current = localRule.sequenceSteps || [];
    const lastStep = current[current.length - 1];
    const newStep: SequenceStep = {
      order: current.length + 1,
      delayHours: (lastStep?.delayHours ?? 24) + 24,
      delayMinutes: 0,
      style: "value",
    };
    updateLocalRule("sequenceSteps", [...current, newStep]);
  };

  const updateStep = (idx: number, updates: Partial<SequenceStep>) => {
    const steps = [...(localRule.sequenceSteps || [])];
    steps[idx] = { ...steps[idx], ...updates };
    updateLocalRule("sequenceSteps", steps);
  };

  const removeStep = (idx: number) => {
    const steps = (localRule.sequenceSteps || []).filter((_, i) => i !== idx);
    // Re-number
    const renumbered = steps.map((s, i) => ({ ...s, order: i + 1 }));
    updateLocalRule("sequenceSteps", renumbered.length > 0 ? renumbered : undefined);
  };

  const addTag = (type: "filterTags" | "filterTagsExclude") => {
    if (!tagInput.trim()) return;
    const currentTags = (localRule[type] || []) as string[];
    if (!currentTags.includes(tagInput.trim())) {
      updateLocalRule(type, [...currentTags, tagInput.trim()]);
    }
    setTagInput("");
  };

  const removeTag = (type: "filterTags" | "filterTagsExclude", tag: string) => {
    const currentTags = (localRule[type] || []) as string[];
    updateLocalRule(type, currentTags.filter((t) => t !== tag));
  };

  const triggerLabel = TRIGGER_TYPES.find((t) => t.value === rule.triggerType)?.label || rule.triggerType;

  return (
    <Card className={!rule.isActive ? "opacity-60" : ""}>
      <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
            <Switch
              checked={rule.isActive}
              onCheckedChange={onToggleActive}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold truncate">{rule.name || `Regra ${index + 1}`}</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {triggerLabel}
                </Badge>
                {isCadenceMode && (
                  <Badge variant="outline" className="text-[10px] shrink-0 text-primary border-primary/40">
                    Cadencia
                  </Badge>
                )}
                {hasChanges && (
                  <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500 shrink-0">
                    Nao salvo
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isCadenceMode
                  ? `${localRule.sequenceSteps!.length} passos`
                  : `${rule.triggerDelayHours}h ${rule.triggerDelayMinutes || 0}min`}
                {" / "}
                {FOLLOWUP_STYLES.find((s) => s.value === rule.followupStyle)?.label || rule.followupStyle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="outline" className="text-[10px]">
              P{rule.priority}
            </Badge>
            {hasChanges && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleSave} disabled={isSaving}>
                <Save className="w-3.5 h-3.5 mr-1" />
                Salvar
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-6">
            {/* Nome + Prioridade */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome da Regra</Label>
                <Input
                  value={localRule.name}
                  onChange={(e) => updateLocalRule("name", e.target.value)}
                  placeholder="Ex: Follow-up 24h"
                />
              </div>
              <div className="space-y-2">
                <Label>Prioridade</Label>
                <Input
                  type="number"
                  min={0}
                  value={localRule.priority}
                  onChange={(e) => updateLocalRule("priority", parseInt(e.target.value) || 0)}
                />
              </div>
            </div>

            {/* Trigger Type */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Zap className="w-4 h-4 text-primary" />
                Gatilho
              </div>
              <div className="space-y-2">
                <Label>Tipo de gatilho</Label>
                <Select
                  value={localRule.triggerType}
                  onValueChange={(v) => updateLocalRule("triggerType", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Cadence toggle */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ListOrdered className="w-4 h-4 text-primary" />
                Modo
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={isCadenceMode} onCheckedChange={toggleCadenceMode} />
                <Label>Cadencia multi-step</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="w-3.5 h-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>Ativa: sequencia de passos com delay e estilo individual. Desligado: disparo unico apos o delay configurado.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Single-shot controls */}
            {!isCadenceMode && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="w-4 h-4 text-primary" />
                  Tempo e Estilo
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Horas</Label>
                    <Input
                      type="number"
                      min={0}
                      value={localRule.triggerDelayHours}
                      onChange={(e) => updateLocalRule("triggerDelayHours", parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Minutos</Label>
                    <Input
                      type="number"
                      min={0}
                      max={59}
                      value={localRule.triggerDelayMinutes}
                      onChange={(e) => updateLocalRule("triggerDelayMinutes", parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max. follow-ups</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={localRule.maxFollowups}
                      onChange={(e) => updateLocalRule("maxFollowups", parseInt(e.target.value) || 1)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Estilo da mensagem</Label>
                    <Select
                      value={localRule.followupStyle}
                      onValueChange={(v) => updateLocalRule("followupStyle", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FOLLOWUP_STYLES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label} - {s.description}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Historico (dias)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={90}
                      value={localRule.contextLookbackDays}
                      onChange={(e) => updateLocalRule("contextLookbackDays", parseInt(e.target.value) || 30)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    Template (opcional)
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="w-3 h-3 ml-1 inline text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Variaveis: {"{nome}"}, {"{primeiro_nome}"}, {"{empresa}"}, {"{ultimo_assunto}"}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Textarea
                    value={localRule.messageTemplate || ""}
                    onChange={(e) => updateLocalRule("messageTemplate", e.target.value)}
                    placeholder="Deixe vazio para gerar automaticamente"
                    rows={3}
                  />
                </div>
              </div>
            )}

            {/* Cadence step editor */}
            {isCadenceMode && localRule.sequenceSteps && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ListOrdered className="w-4 h-4 text-primary" />
                  Passos da Cadencia
                </div>

                <div className="space-y-1 pl-1">
                  {localRule.sequenceSteps.map((step, idx) => (
                    <StepEditor
                      key={idx}
                      step={step}
                      index={idx}
                      onUpdate={(updates) => updateStep(idx, updates)}
                      onRemove={() => removeStep(idx)}
                      isOnly={localRule.sequenceSteps!.length === 1}
                    />
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={addStep}
                  className="w-full"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Adicionar passo
                </Button>
              </div>
            )}

            {/* Filters (collapsible) */}
            <Collapsible>
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-2 text-sm font-medium w-full text-left hover:text-primary transition-colors">
                  <Filter className="w-4 h-4 text-primary" />
                  Filtros de Leads
                  <ChevronDown className="w-3.5 h-3.5 ml-auto" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-3">
                {/* Tags */}
                <div className="space-y-2">
                  <Label>Tags que o lead DEVE ter</Label>
                  <div className="flex gap-2">
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      placeholder="Digite uma tag"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag("filterTags");
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={() => addTag("filterTags")}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(localRule.filterTags || []).map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => removeTag("filterTags", tag)}
                      >
                        {tag} x
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Pipelines + Stages */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pipelines</Label>
                    <Select
                      value=""
                      onValueChange={(value) => {
                        const current = localRule.filterPipes || [];
                        if (!current.includes(value)) {
                          updateLocalRule("filterPipes", [...current, value]);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {pipeTypeOptions.map((pipe) => (
                          <SelectItem key={pipe.value} value={pipe.value}>
                            {pipe.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex flex-wrap gap-2">
                      {(localRule.filterPipes || []).map((pipe) => (
                        <Badge
                          key={pipe}
                          variant="outline"
                          className="cursor-pointer"
                          onClick={() => updateLocalRule("filterPipes", (localRule.filterPipes || []).filter((p) => p !== pipe))}
                        >
                          {pipeTypeOptions.find((p) => p.value === pipe)?.label || pipe} x
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Etapas</Label>
                    <Select
                      value=""
                      onValueChange={(value) => {
                        const current = localRule.filterStages || [];
                        if (!current.includes(value)) {
                          updateLocalRule("filterStages", [...current, value]);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {(localRule.filterPipes || []).flatMap((pipe) =>
                          (stagesByPipe[pipe] || []).map((stage) => (
                            <SelectItem key={`${pipe}-${stage.value}`} value={stage.value}>
                              {stage.label}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <div className="flex flex-wrap gap-2">
                      {(localRule.filterStages || []).map((stage) => (
                        <Badge
                          key={stage}
                          variant="outline"
                          className="cursor-pointer"
                          onClick={() => updateLocalRule("filterStages", (localRule.filterStages || []).filter((s) => s !== stage))}
                        >
                          {stage} x
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Business Hours */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Calendar className="w-4 h-4 text-primary" />
                Horarios de Envio
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={localRule.sendOnlyBusinessHours}
                  onCheckedChange={(checked) => updateLocalRule("sendOnlyBusinessHours", checked)}
                />
                <Label>Apenas horario comercial</Label>
              </div>

              {localRule.sendOnlyBusinessHours && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Inicio</Label>
                    <Input
                      type="time"
                      value={localRule.businessHoursStart}
                      onChange={(e) => updateLocalRule("businessHoursStart", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Fim</Label>
                    <Input
                      type="time"
                      value={localRule.businessHoursEnd}
                      onChange={(e) => updateLocalRule("businessHoursEnd", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Fuso</Label>
                    <Select
                      value={localRule.timezone}
                      onValueChange={(value) => updateLocalRule("timezone", value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="America/Sao_Paulo">Sao Paulo</SelectItem>
                        <SelectItem value="America/Manaus">Manaus</SelectItem>
                        <SelectItem value="America/Recife">Recife</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Dias da semana</Label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day) => (
                    <Badge
                      key={day.value}
                      variant={(localRule.sendDays || []).includes(day.value) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => {
                        const currentDays = localRule.sendDays || [];
                        if (currentDays.includes(day.value)) {
                          updateLocalRule("sendDays", currentDays.filter((d) => d !== day.value));
                        } else {
                          updateLocalRule("sendDays", [...currentDays, day.value]);
                        }
                      }}
                    >
                      {day.label}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// =====================================================
// MAIN COMPONENT
// =====================================================

interface PlaygroundFollowupProps {
  agentId: string | undefined;
}

export function PlaygroundFollowup({ agentId }: PlaygroundFollowupProps) {
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});

  const { data: rules = [], isLoading } = useAgentFollowupRules(agentId);
  const createRule = useCreateFollowupRule();
  const updateRule = useUpdateFollowupRule();
  const deleteRule = useDeleteFollowupRule();
  const toggleRule = useToggleFollowupRule();

  const handleAddRule = () => {
    if (!agentId) return;
    createRule.mutate({
      agentId,
      rule: {
        ...DEFAULT_RULE,
        name: `Regra ${rules.length + 1}`,
        priority: rules.length,
      },
    });
  };

  const handleUpdateRule = (ruleId: string, updates: Partial<FollowupRule>) => {
    if (!agentId) return;
    updateRule.mutate({ ruleId, agentId, updates });
  };

  const handleDeleteRule = (ruleId: string) => {
    if (!agentId) return;
    if (confirm("Tem certeza que deseja excluir esta regra?")) {
      deleteRule.mutate({ ruleId, agentId });
    }
  };

  const handleToggleRule = (ruleId: string, isActive: boolean) => {
    if (!agentId) return;
    toggleRule.mutate({ ruleId, agentId, isActive });
  };

  if (!agentId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">Salve o agente primeiro</p>
        <p className="text-sm mt-1">Regras de follow-up ficam disponiveis apos o primeiro save.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Carregando regras...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Regras de Follow-up</h3>
        <p className="text-sm text-muted-foreground">
          Configure cadencias e disparos automaticos para follow-up com leads
        </p>
      </div>

      {/* Rules list */}
      <ScrollArea className="max-h-[500px] pr-2">
        <div className="space-y-3">
          <AnimatePresence>
            {rules.map((rule, index) => (
              <motion.div
                key={rule.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <FollowupRuleCard
                  rule={rule}
                  index={index}
                  isExpanded={expandedRules[rule.id!] || false}
                  onToggleExpand={() =>
                    setExpandedRules((prev) => ({
                      ...prev,
                      [rule.id!]: !prev[rule.id!],
                    }))
                  }
                  onUpdate={(updates) => handleUpdateRule(rule.id!, updates)}
                  onDelete={() => handleDeleteRule(rule.id!)}
                  onToggleActive={(isActive) => handleToggleRule(rule.id!, isActive)}
                  isSaving={updateRule.isPending}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* Add rule button */}
      <Button
        variant="outline"
        onClick={handleAddRule}
        disabled={createRule.isPending}
        className="w-full"
      >
        {createRule.isPending ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Plus className="w-4 h-4 mr-2" />
        )}
        Adicionar Regra
      </Button>

      {rules.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-muted-foreground">
            <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium">Nenhuma regra configurada</p>
            <p className="text-sm mt-1">
              Adicione regras para follow-up automatico
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
