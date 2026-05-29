/**
 * Aba de Regras por Etapa (Kanban Rules)
 *
 * Configura goal, behavior, allowed_actions e forbidden_actions por etapa
 * do funil WhatsApp. Essas regras são injetadas no prompt do AgentEngine.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { LayoutList, Save, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { Badge } from "@/components/ui/badge";
import { usePipelineStageOptions } from "@/modules/pipelines";
import {
  useAgentKanbanRules,
  useUpsertKanbanRules,
  type KanbanRuleForm,
} from "@/modules/copilot/hooks/useAgentKanbanRules";

const createEmptyRule = (stage: { value: string; label: string }): KanbanRuleForm => ({
  pipe_type: "whatsapp",
  stage_name: stage.value,
  goal: "",
  behavior: "",
  allowed_actions: [],
  forbidden_actions: [],
});

/** Ações disponíveis para o agente - valor técnico e label amigável */
const AVAILABLE_ACTIONS = [
  { value: "schedule_meeting", label: "Agendar reunião" },
  { value: "create_lead", label: "Criar lead no CRM" },
  { value: "update_lead", label: "Atualizar lead no CRM" },
  { value: "update_crm", label: "Atualizar CRM externo" },
  { value: "transfer_to_human", label: "Transferir para humano" },
] as const;

interface AgentKanbanRulesTabProps {
  agentId: string;
}

function ActionsMultiSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const toggle = useCallback(
    (value: string) => {
      if (selected.includes(value)) {
        onChange(selected.filter((v) => v !== value));
      } else {
        onChange([...selected, value]);
      }
    },
    [selected, onChange]
  );

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {AVAILABLE_ACTIONS.map(({ value, label }) => (
        <label
          key={value}
          className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
        >
          <Checkbox
            checked={selected.includes(value)}
            onCheckedChange={() => toggle(value)}
          />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground ml-1">({value})</span>
        </label>
      ))}
    </div>
  );
}

function StageCollapsible({
  stage,
  rule,
  onUpdate,
  isExpanded,
  onToggle,
  needsReview,
}: {
  stage: { value: string; label: string };
  rule: KanbanRuleForm;
  onUpdate: (updates: Partial<KanbanRuleForm>) => void;
  isExpanded: boolean;
  onToggle: () => void;
  needsReview?: boolean;
}) {
  const hasContent =
    (rule.goal && rule.goal.trim()) ||
    (rule.behavior && rule.behavior.trim()) ||
    (rule.allowed_actions?.length ?? 0) > 0 ||
    (rule.forbidden_actions?.length ?? 0) > 0;

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-2">
            <span className="font-medium">{stage.label}</span>
            {hasContent ? (
              <Badge variant="outline" className="text-xs">
                Configurado
              </Badge>
            ) : null}
            {needsReview && (
              <Badge variant="outline" className="text-xs text-amber-500 border-amber-500">
                Auto-gerada
              </Badge>
            )}
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-4 pt-2 space-y-4 border border-t-0 rounded-b-lg bg-muted/30">
          <div className="space-y-2">
            <Label htmlFor={`goal-${stage.value}`}>Objetivo desta etapa</Label>
            <Textarea
              id={`goal-${stage.value}`}
              value={rule.goal}
              onChange={(e) => onUpdate({ goal: e.target.value })}
              placeholder="Ex.: Qualificar o lead e coletar informações mínimas"
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`behavior-${stage.value}`}>
              Comportamento esperado
            </Label>
            <Textarea
              id={`behavior-${stage.value}`}
              value={rule.behavior}
              onChange={(e) => onUpdate({ behavior: e.target.value })}
              placeholder="Ex.: Seja cordial, faça no máximo 1 pergunta por mensagem"
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="space-y-2">
            <Label>Ações permitidas</Label>
            <p className="text-xs text-muted-foreground">
              Selecione as ações que a IA pode executar nesta etapa
            </p>
            <ActionsMultiSelect
              selected={rule.allowed_actions || []}
              onChange={(arr) => onUpdate({ allowed_actions: arr })}
            />
          </div>
          <div className="space-y-2">
            <Label>Ações proibidas</Label>
            <p className="text-xs text-muted-foreground">
              Selecione as ações que a IA não deve executar nesta etapa
            </p>
            <ActionsMultiSelect
              selected={rule.forbidden_actions || []}
              onChange={(arr) => onUpdate({ forbidden_actions: arr })}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AgentKanbanRulesTab({ agentId }: AgentKanbanRulesTabProps) {
  const { options: whatsappStageOptions } = usePipelineStageOptions("whatsapp");
  const WHATSAPP_STAGES = useMemo(() => [
    ...whatsappStageOptions,
    { value: "aguardando_humano", label: "Aguardando Humano" },
    { value: "descartado", label: "Descartado" },
  ], [whatsappStageOptions]);

  const { data: rules, isLoading } = useAgentKanbanRules(agentId);
  const upsert = useUpsertKanbanRules(agentId);

  const [localRules, setLocalRules] = useState<Record<string, KanbanRuleForm>>(
    () =>
      WHATSAPP_STAGES.reduce(
        (acc, s) => {
          acc[s.value] = createEmptyRule(s);
          return acc;
        },
        {} as Record<string, KanbanRuleForm>
      )
  );
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    if (!rules || rules.length === 0) return;

    const byStage = WHATSAPP_STAGES.reduce(
      (acc, s) => {
        const existing = rules.find(
          (r) => r.pipe_type === "whatsapp" && r.stage_name === s.value
        );
        acc[s.value] = {
          pipe_type: "whatsapp",
          stage_name: s.value,
          goal: existing?.goal ?? "",
          behavior: existing?.behavior ?? "",
          allowed_actions: existing?.allowed_actions ?? [],
          forbidden_actions: existing?.forbidden_actions ?? [],
        };
        return acc;
      },
      {} as Record<string, KanbanRuleForm>
    );
    setLocalRules(byStage);
  }, [rules, WHATSAPP_STAGES]);

  const updateRule = useCallback((stageValue: string, updates: Partial<KanbanRuleForm>) => {
    setLocalRules((prev) => ({
      ...prev,
      [stageValue]: { ...prev[stageValue], ...updates },
    }));
  }, []);

  const toggleStage = useCallback((stageValue: string) => {
    setExpandedStages((prev) => ({
      ...prev,
      [stageValue]: !prev[stageValue],
    }));
  }, []);

  const handleSave = useCallback(() => {
    const toSave = WHATSAPP_STAGES.map((s) => localRules[s.value] ?? createEmptyRule(s));
    upsert.mutate(toSave);
  }, [localRules, upsert, WHATSAPP_STAGES]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutList className="w-5 h-5" />
          Regras por Etapa do Funil WhatsApp
        </CardTitle>
        <CardDescription className="flex items-start gap-2">
          <span>
            Configure o objetivo e comportamento da IA em cada etapa. Essas regras
            são injetadas no prompt quando o lead está na etapa correspondente.
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                As regras orientam a IA sobre o que priorizar e o que evitar em
                cada etapa do funil.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {WHATSAPP_STAGES.map((stage) => (
            <StageCollapsible
              key={stage.value}
              stage={stage}
              rule={localRules[stage.value] ?? createEmptyRule(stage)}
              onUpdate={(updates) => updateRule(stage.value, updates)}
              isExpanded={expandedStages[stage.value] ?? false}
              onToggle={() => toggleStage(stage.value)}
              needsReview={rules?.find(r => r.pipe_type === "whatsapp" && r.stage_name === stage.value)?.needs_review ?? false}
            />
          ))}
        </div>
        <div className="pt-4">
          <Button
            onClick={handleSave}
            disabled={upsert.isPending}
          >
            {upsert.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Salvar Regras
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
