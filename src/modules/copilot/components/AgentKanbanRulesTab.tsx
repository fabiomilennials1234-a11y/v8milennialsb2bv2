/**
 * Aba de Regras por Etapa (Kanban Rules)
 *
 * Configura goal, behavior, allowed_actions e forbidden_actions por etapa de
 * QUALQUER funil da organização (SCRUM-628 — antes era preso ao funil
 * WhatsApp). As regras são injetadas no prompt do AgentEngine quando o negócio
 * do lead está na etapa correspondente.
 *
 * Formato: regras novas gravam `pipe_type = uuid do funil` e `stage_name =
 * uuid da etapa`; regras legadas (slug + stage_key) são resolvidas na leitura
 * e regravadas no formato novo ao salvar. Regras de campanha e regras cujo
 * funil/etapa não existe mais são preservadas intactas no save.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { usePipelines } from "@/modules/pipelines";
import {
  useAgentKanbanRules,
  useUpsertKanbanRules,
  type KanbanRuleForm,
} from "@/modules/copilot/hooks/useAgentKanbanRules";
import { useOrgFunnelStages, type OrgFunnelStage } from "@/modules/copilot/hooks/useOrgFunnelStages";
import {
  isFunnelRule,
  resolveRuleFunnel,
  resolveRuleStage,
} from "@/modules/copilot/lib/kanban-rule-refs";

/** Conteúdo editável de uma regra (a referência funil/etapa vive na chave). */
interface RuleDraft {
  goal: string;
  behavior: string;
  allowed_actions: string[];
  forbidden_actions: string[];
  needs_review?: boolean;
}

const EMPTY_DRAFT: RuleDraft = {
  goal: "",
  behavior: "",
  allowed_actions: [],
  forbidden_actions: [],
};

const draftKey = (pipelineId: string, stageId: string) => `${pipelineId}:${stageId}`;

const draftHasContent = (draft: RuleDraft) =>
  !!draft.goal.trim() ||
  !!draft.behavior.trim() ||
  draft.allowed_actions.length > 0 ||
  draft.forbidden_actions.length > 0;

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
}: {
  stage: OrgFunnelStage;
  rule: RuleDraft;
  onUpdate: (updates: Partial<RuleDraft>) => void;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasContent = draftHasContent(rule);

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-2">
            <span className="font-medium">{stage.name || stage.stage_key}</span>
            {hasContent ? (
              <Badge variant="outline" className="text-xs">
                Configurado
              </Badge>
            ) : null}
            {rule.needs_review && (
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
            <Label htmlFor={`goal-${stage.id}`}>Objetivo desta etapa</Label>
            <Textarea
              id={`goal-${stage.id}`}
              value={rule.goal}
              onChange={(e) => onUpdate({ goal: e.target.value })}
              placeholder="Ex.: Qualificar o lead e coletar informações mínimas"
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`behavior-${stage.id}`}>
              Comportamento esperado
            </Label>
            <Textarea
              id={`behavior-${stage.id}`}
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
              selected={rule.allowed_actions}
              onChange={(arr) => onUpdate({ allowed_actions: arr })}
            />
          </div>
          <div className="space-y-2">
            <Label>Ações proibidas</Label>
            <p className="text-xs text-muted-foreground">
              Selecione as ações que a IA não deve executar nesta etapa
            </p>
            <ActionsMultiSelect
              selected={rule.forbidden_actions}
              onChange={(arr) => onUpdate({ forbidden_actions: arr })}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AgentKanbanRulesTab({ agentId }: AgentKanbanRulesTabProps) {
  const { data: pipelines = [], isLoading: loadingPipelines } = usePipelines();
  const { byPipelineId, isLoading: loadingStages } = useOrgFunnelStages();
  const { data: rules, isLoading: loadingRules } = useAgentKanbanRules(agentId);
  const upsert = useUpsertKanbanRules(agentId);

  const activeFunnels = useMemo(
    () => pipelines.filter((p) => p.is_active !== false),
    [pipelines]
  );

  const [selectedFunnelId, setSelectedFunnelId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({});
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  // Regras que esta aba NÃO edita (campanha; funil/etapa que não existe mais).
  // Preservadas byte-a-byte no save — salvar um funil não pode apagar as outras.
  const passthroughRules = useMemo<KanbanRuleForm[]>(() => {
    if (!rules) return [];
    return rules
      .filter((r) => {
        if (!isFunnelRule(r)) return true;
        const funnel = resolveRuleFunnel(r, activeFunnels);
        if (!funnel) return true;
        const stage = resolveRuleStage(r, byPipelineId.get(funnel.id) ?? []);
        return !stage;
      })
      .map((r) => ({
        pipe_type: r.pipe_type,
        stage_name: r.stage_name,
        goal: r.goal ?? "",
        behavior: r.behavior ?? "",
        allowed_actions: (r.allowed_actions as string[]) ?? [],
        forbidden_actions: (r.forbidden_actions as string[]) ?? [],
      }));
  }, [rules, activeFunnels, byPipelineId]);

  // Hidratação: resolve cada regra salva (formato novo OU legado) para o par
  // (funil, etapa) real e semeia os drafts. Roda uma vez, com tudo carregado.
  useEffect(() => {
    if (hydrated || loadingPipelines || loadingStages || loadingRules) return;

    const seeded: Record<string, RuleDraft> = {};
    let firstRuleFunnel: string | null = null;

    for (const rule of rules ?? []) {
      if (!isFunnelRule(rule)) continue;
      const funnel = resolveRuleFunnel(rule, activeFunnels);
      if (!funnel) continue;
      const stage = resolveRuleStage(rule, byPipelineId.get(funnel.id) ?? []);
      if (!stage) continue;
      if (!firstRuleFunnel) firstRuleFunnel = funnel.id;
      seeded[draftKey(funnel.id, stage.id)] = {
        goal: rule.goal ?? "",
        behavior: rule.behavior ?? "",
        allowed_actions: (rule.allowed_actions as string[]) ?? [],
        forbidden_actions: (rule.forbidden_actions as string[]) ?? [],
        needs_review: rule.needs_review ?? false,
      };
    }

    setDrafts(seeded);
    setSelectedFunnelId((prev) => prev ?? firstRuleFunnel ?? activeFunnels[0]?.id ?? null);
    setHydrated(true);
  }, [hydrated, loadingPipelines, loadingStages, loadingRules, rules, activeFunnels, byPipelineId]);

  const selectedStages = useMemo(
    () => (selectedFunnelId ? byPipelineId.get(selectedFunnelId) ?? [] : []),
    [selectedFunnelId, byPipelineId]
  );

  const updateDraft = useCallback(
    (stageId: string, updates: Partial<RuleDraft>) => {
      if (!selectedFunnelId) return;
      const key = draftKey(selectedFunnelId, stageId);
      setDrafts((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? EMPTY_DRAFT), ...updates, needs_review: false },
      }));
    },
    [selectedFunnelId]
  );

  const toggleStage = useCallback((stageId: string) => {
    setExpandedStages((prev) => ({ ...prev, [stageId]: !prev[stageId] }));
  }, []);

  const configuredByFunnel = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [key, draft] of Object.entries(drafts)) {
      if (!draftHasContent(draft)) continue;
      const pipelineId = key.split(":")[0];
      counts.set(pipelineId, (counts.get(pipelineId) ?? 0) + 1);
    }
    return counts;
  }, [drafts]);

  const handleSave = useCallback(() => {
    // Formato NOVO no save: pipe_type = uuid do funil, stage_name = uuid da
    // etapa — sobrevive a rename de slug/stage_key. Regras legadas resolvidas
    // na hidratação são regravadas já no formato novo.
    const funnelRules: KanbanRuleForm[] = Object.entries(drafts)
      .filter(([, draft]) => draftHasContent(draft))
      .map(([key, draft]) => {
        const [pipelineId, stageId] = key.split(":");
        return {
          pipe_type: pipelineId,
          stage_name: stageId,
          goal: draft.goal,
          behavior: draft.behavior,
          allowed_actions: draft.allowed_actions,
          forbidden_actions: draft.forbidden_actions,
        };
      });
    upsert.mutate([...funnelRules, ...passthroughRules]);
  }, [drafts, passthroughRules, upsert]);

  if (loadingRules || loadingPipelines || loadingStages) {
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
          Regras por Etapa do Funil
        </CardTitle>
        <CardDescription className="flex items-start gap-2">
          <span>
            Escolha um funil e configure o objetivo e o comportamento da IA em
            cada etapa. As regras são injetadas no prompt quando o negócio do
            lead está na etapa correspondente.
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                As regras orientam a IA sobre o que priorizar e o que evitar em
                cada etapa — em qualquer funil da organização, inclusive funis
                personalizados.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="kanban-rules-funnel">Funil</Label>
          <Select
            value={selectedFunnelId ?? undefined}
            onValueChange={(value) => setSelectedFunnelId(value)}
          >
            <SelectTrigger id="kanban-rules-funnel" className="w-full sm:w-80">
              <SelectValue placeholder="Selecione um funil" />
            </SelectTrigger>
            <SelectContent>
              {activeFunnels.map((funnel) => {
                const count = configuredByFunnel.get(funnel.id) ?? 0;
                return (
                  <SelectItem key={funnel.id} value={funnel.id}>
                    {funnel.name}
                    {count > 0 ? ` — ${count} regra${count > 1 ? "s" : ""}` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {activeFunnels.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Nenhum funil ativo na organização.
          </p>
        ) : selectedStages.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Este funil não tem etapas ativas.
          </p>
        ) : (
          <div className="space-y-2">
            {selectedStages.map((stage) => (
              <StageCollapsible
                key={stage.id}
                stage={stage}
                rule={
                  (selectedFunnelId && drafts[draftKey(selectedFunnelId, stage.id)]) ||
                  EMPTY_DRAFT
                }
                onUpdate={(updates) => updateDraft(stage.id, updates)}
                isExpanded={expandedStages[stage.id] ?? false}
                onToggle={() => toggleStage(stage.id)}
              />
            ))}
          </div>
        )}

        <div className="pt-4">
          <Button onClick={handleSave} disabled={upsert.isPending}>
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
