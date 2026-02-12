/**
 * Aba de Regras por Etapa (Kanban Rules)
 *
 * Configura goal, behavior, allowed_actions e forbidden_actions por etapa
 * do funil WhatsApp. Essas regras são injetadas no prompt do AgentEngine.
 */

import { useState, useEffect, useCallback } from "react";
import { LayoutList, Save, Loader2, Plus, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { PIPE_STAGES } from "@/types/copilot";
import {
  useAgentKanbanRules,
  useUpsertKanbanRules,
  type KanbanRuleForm,
} from "@/hooks/useAgentKanbanRules";

const WHATSAPP_STAGES = [
  ...(PIPE_STAGES["whatsapp"] || []),
  { value: "aguardando_humano", label: "Aguardando Humano" },
  { value: "descartado", label: "Descartado" },
];

const createEmptyRule = (stage: { value: string; label: string }): KanbanRuleForm => ({
  pipe_type: "whatsapp",
  stage_name: stage.value,
  goal: "",
  behavior: "",
  allowed_actions: [],
  forbidden_actions: [],
});

interface AgentKanbanRulesTabProps {
  agentId: string;
}

function TagsInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");

  const addTag = useCallback(() => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
      setInput("");
    }
  }, [input, tags, onChange]);

  const removeTag = useCallback(
    (tag: string) => {
      onChange(tags.filter((t) => t !== tag));
    },
    [tags, onChange]
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
        />
        <Button type="button" variant="outline" size="icon" onClick={addTag}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => removeTag(tag)}
            >
              {tag} <X className="w-3 h-3 ml-1" />
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StageCollapsible({
  stage,
  rule,
  onUpdate,
  isExpanded,
  onToggle,
}: {
  stage: { value: string; label: string };
  rule: KanbanRuleForm;
  onUpdate: (updates: Partial<KanbanRuleForm>) => void;
  isExpanded: boolean;
  onToggle: () => void;
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
            <TagsInput
              tags={rule.allowed_actions || []}
              onChange={(arr) => onUpdate({ allowed_actions: arr })}
              placeholder="Ex.: schedule_meeting, transfer_to_human"
            />
          </div>
          <div className="space-y-2">
            <Label>Ações proibidas</Label>
            <TagsInput
              tags={rule.forbidden_actions || []}
              onChange={(arr) => onUpdate({ forbidden_actions: arr })}
              placeholder="Ex.: create_lead, update_crm"
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AgentKanbanRulesTab({ agentId }: AgentKanbanRulesTabProps) {
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
  }, [rules]);

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
  }, [localRules, upsert]);

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
