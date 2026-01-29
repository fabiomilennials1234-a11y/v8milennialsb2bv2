/**
 * Aba de Configuração de Regras de Follow-up
 *
 * Permite configurar gatilhos de tempo, filtros de leads e comportamento
 * para follow-up automático baseado em contexto.
 * 
 * Visível apenas para agentes do tipo "followup"
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  Tag,
  Filter,
  MessageSquare,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Zap,
  Calendar,
  Settings2,
  Info,
  Loader2,
  Save,
  GripVertical,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FollowupRule } from "@/types/copilot";
import { PIPE_TYPES, PIPE_STAGES } from "@/types/copilot";
import {
  useAgentFollowupRules,
  useCreateFollowupRule,
  useUpdateFollowupRule,
  useDeleteFollowupRule,
  useToggleFollowupRule,
} from "@/hooks/useAgentFollowupRules";

interface AgentFollowupRulesTabProps {
  agentId: string;
}

const FOLLOWUP_STYLES = [
  { value: "direct", label: "Direto", description: "Pergunta direta sobre o assunto anterior" },
  { value: "value", label: "Valor", description: "Agrega valor com conteúdo relevante" },
  { value: "curiosity", label: "Curiosidade", description: "Gera curiosidade com novidade" },
  { value: "breakup", label: "Breakup", description: "Última tentativa antes de parar" },
];

const DAYS_OF_WEEK = [
  { value: "seg", label: "Seg" },
  { value: "ter", label: "Ter" },
  { value: "qua", label: "Qua" },
  { value: "qui", label: "Qui" },
  { value: "sex", label: "Sex" },
  { value: "sab", label: "Sáb" },
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

function RuleCard({
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

  const updateLocalRule = (field: string, value: any) => {
    setLocalRule((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    onUpdate(localRule);
    setHasChanges(false);
  };

  const addTag = (type: "filterTags" | "filterTagsExclude") => {
    if (!tagInput.trim()) return;
    const currentTags = localRule[type] || [];
    if (!currentTags.includes(tagInput.trim())) {
      updateLocalRule(type, [...currentTags, tagInput.trim()]);
    }
    setTagInput("");
  };

  const removeTag = (type: "filterTags" | "filterTagsExclude", tag: string) => {
    const currentTags = localRule[type] || [];
    updateLocalRule(type, currentTags.filter((t) => t !== tag));
  };

  return (
    <Card className={!rule.isActive ? "opacity-60" : ""}>
      <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
              <Switch
                checked={rule.isActive}
                onCheckedChange={onToggleActive}
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{rule.name || `Regra ${index + 1}`}</span>
                  {hasChanges && (
                    <Badge variant="outline" className="text-xs text-amber-500 border-amber-500">
                      Não salvo
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {rule.triggerDelayHours}h sem resposta → Estilo: {
                    FOLLOWUP_STYLES.find(s => s.value === rule.followupStyle)?.label
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                Prioridade: {rule.priority}
              </Badge>
              {hasChanges && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  <Save className="w-4 h-4 mr-1" />
                  Salvar
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onDelete}
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon">
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-6">
            {/* Nome e Descrição */}
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

            {/* Gatilhos de Tempo */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="w-4 h-4 text-millennials-yellow" />
                Gatilho de Tempo
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Horas sem resposta</Label>
                  <Input
                    type="number"
                    min={0}
                    value={localRule.triggerDelayHours}
                    onChange={(e) => updateLocalRule("triggerDelayHours", parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Minutos adicionais</Label>
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={localRule.triggerDelayMinutes}
                    onChange={(e) => updateLocalRule("triggerDelayMinutes", parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Máx. follow-ups</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={localRule.maxFollowups}
                    onChange={(e) => updateLocalRule("maxFollowups", parseInt(e.target.value) || 1)}
                  />
                </div>
              </div>
            </div>

            {/* Filtros de Leads */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Filter className="w-4 h-4 text-millennials-yellow" />
                Filtros de Leads
              </div>

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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => addTag("filterTags")}
                  >
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
                      {tag} ×
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Pipelines */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Pipelines</Label>
                  <Select
                    value=""
                    onValueChange={(value) => {
                      const currentPipes = localRule.filterPipes || [];
                      if (!currentPipes.includes(value)) {
                        updateLocalRule("filterPipes", [...currentPipes, value]);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {PIPE_TYPES.map((pipe) => (
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
                        onClick={() => {
                          updateLocalRule("filterPipes", (localRule.filterPipes || []).filter((p) => p !== pipe));
                        }}
                      >
                        {PIPE_TYPES.find(p => p.value === pipe)?.label || pipe} ×
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Etapas</Label>
                  <Select
                    value=""
                    onValueChange={(value) => {
                      const currentStages = localRule.filterStages || [];
                      if (!currentStages.includes(value)) {
                        updateLocalRule("filterStages", [...currentStages, value]);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {(localRule.filterPipes || []).flatMap((pipe) =>
                        (PIPE_STAGES[pipe] || []).map((stage) => (
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
                        onClick={() => {
                          updateLocalRule("filterStages", (localRule.filterStages || []).filter((s) => s !== stage));
                        }}
                      >
                        {stage} ×
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Comportamento */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="w-4 h-4 text-millennials-yellow" />
                Comportamento
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Estilo da mensagem</Label>
                  <Select
                    value={localRule.followupStyle}
                    onValueChange={(value) => updateLocalRule("followupStyle", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FOLLOWUP_STYLES.map((style) => (
                        <SelectItem key={style.value} value={style.value}>
                          {style.label} - {style.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Histórico (dias)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={localRule.contextLookbackDays}
                    onChange={(e) => updateLocalRule("contextLookbackDays", parseInt(e.target.value) || 30)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={localRule.useLastContext}
                    onCheckedChange={(checked) => updateLocalRule("useLastContext", checked)}
                  />
                  <Label>Usar contexto da última conversa</Label>
                </div>
              </div>

              <div className="space-y-2">
                <Label>
                  Template da mensagem (opcional)
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="w-3 h-3 ml-1 inline text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Variáveis: {"{nome}"}, {"{empresa}"}, {"{ultimo_assunto}"}</p>
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

            {/* Horários */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Calendar className="w-4 h-4 text-millennials-yellow" />
                Horários de Envio
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={localRule.sendOnlyBusinessHours}
                  onCheckedChange={(checked) => updateLocalRule("sendOnlyBusinessHours", checked)}
                />
                <Label>Apenas horário comercial</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Se o disparo (ex.: 24h sem resposta) cair fora do horário ou dos dias configurados,
                o envio será agendado para o <strong>início do próximo horário comercial</strong>,
                para que todos os leads que qualificaram recebam o follow-up.
              </p>

              {localRule.sendOnlyBusinessHours && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Início</Label>
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
                        <SelectItem value="America/Sao_Paulo">São Paulo</SelectItem>
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

export function AgentFollowupRulesTab({ agentId }: AgentFollowupRulesTabProps) {
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});
  
  const { data: rules = [], isLoading } = useAgentFollowupRules(agentId);
  const createRule = useCreateFollowupRule();
  const updateRule = useUpdateFollowupRule();
  const deleteRule = useDeleteFollowupRule();
  const toggleRule = useToggleFollowupRule();

  const handleAddRule = () => {
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
    updateRule.mutate({ ruleId, agentId, updates });
  };

  const handleDeleteRule = (ruleId: string) => {
    if (confirm('Tem certeza que deseja excluir esta regra?')) {
      deleteRule.mutate({ ruleId, agentId });
    }
  };

  const handleToggleRule = (ruleId: string, isActive: boolean) => {
    toggleRule.mutate({ ruleId, agentId, isActive });
  };

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
          Configure quando e como fazer follow-up automático com leads
        </p>
      </div>

      {/* Dica */}
      <Card className="bg-millennials-yellow/10 border-millennials-yellow/30">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Info className="w-5 h-5 text-millennials-yellow shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-millennials-yellow mb-1">
                Follow-up com Contexto Inteligente
              </p>
              <p className="text-muted-foreground">
                O agente analisa a última conversa e usa o assunto, objeções e perguntas
                do lead para criar mensagens personalizadas automaticamente.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de regras */}
      <ScrollArea className="h-[400px] pr-4">
        <div className="space-y-4">
          <AnimatePresence>
            {rules.map((rule, index) => (
              <motion.div
                key={rule.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <RuleCard
                  rule={rule}
                  index={index}
                  isExpanded={expandedRules[rule.id!] || false}
                  onToggleExpand={() => setExpandedRules((prev) => ({
                    ...prev,
                    [rule.id!]: !prev[rule.id!],
                  }))}
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

      {/* Botão adicionar */}
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
              Adicione regras para follow-up automático
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
