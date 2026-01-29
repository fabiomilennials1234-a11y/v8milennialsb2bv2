/**
 * Step: Configuração de Regras de Follow-up
 *
 * Permite configurar gatilhos de tempo, filtros de leads e comportamento
 * para follow-up automático baseado em contexto.
 */

import { useFormContext, useFieldArray } from "react-hook-form";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  Users,
  Settings2,
  Info,
  AlertCircle,
} from "lucide-react";
import type { CopilotWizardData, FollowupRule } from "@/types/copilot";
import { PIPE_TYPES, PIPE_STAGES } from "@/types/copilot";

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

export function FollowupRulesStep() {
  const { watch, setValue, control } = useFormContext<CopilotWizardData>();
  const [expandedRules, setExpandedRules] = useState<Record<number, boolean>>({});
  const [tagInput, setTagInput] = useState("");
  
  // Usar useFieldArray se disponível ou gerenciar manualmente
  const followupRules = watch("followupRules") || [];

  const toggleRule = (index: number) => {
    setExpandedRules((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const addRule = () => {
    const newRules = [
      ...followupRules,
      {
        ...DEFAULT_RULE,
        name: `Regra ${followupRules.length + 1}`,
        priority: followupRules.length,
      },
    ];
    setValue("followupRules", newRules as any);
    setExpandedRules((prev) => ({ ...prev, [newRules.length - 1]: true }));
  };

  const removeRule = (index: number) => {
    const newRules = followupRules.filter((_, i) => i !== index);
    setValue("followupRules", newRules as any);
  };

  const updateRule = (index: number, field: string, value: any) => {
    const newRules = [...followupRules];
    newRules[index] = { ...newRules[index], [field]: value };
    setValue("followupRules", newRules as any);
  };

  const addTag = (index: number, type: "filterTags" | "filterTagsExclude") => {
    if (!tagInput.trim()) return;
    const currentTags = followupRules[index]?.[type] || [];
    if (!currentTags.includes(tagInput.trim())) {
      updateRule(index, type, [...currentTags, tagInput.trim()]);
    }
    setTagInput("");
  };

  const removeTag = (index: number, type: "filterTags" | "filterTagsExclude", tag: string) => {
    const currentTags = followupRules[index]?.[type] || [];
    updateRule(index, type, currentTags.filter((t: string) => t !== tag));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Regras de Follow-up</h2>
        <p className="text-muted-foreground">
          Configure quando e como o agente deve fazer follow-up com leads que não responderam.
          O agente usará o contexto da última conversa para personalizar a mensagem.
        </p>
      </div>

      {/* Dica de contexto */}
      <Card className="bg-millennials-yellow/10 border-millennials-yellow/30">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Info className="w-5 h-5 text-millennials-yellow shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-millennials-yellow mb-1">
                Follow-up com Contexto Inteligente
              </p>
              <p className="text-muted-foreground">
                O agente analisa automaticamente a última conversa e usa o assunto,
                objeções e perguntas do lead para criar uma mensagem personalizada.
                Você pode configurar diferentes regras para diferentes situações.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de regras */}
      <div className="space-y-4">
        <AnimatePresence>
          {followupRules.map((rule: any, index: number) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <Card className={!rule.isActive ? "opacity-60" : ""}>
                <Collapsible
                  open={expandedRules[index]}
                  onOpenChange={() => toggleRule(index)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={rule.isActive}
                          onCheckedChange={(checked) => updateRule(index, "isActive", checked)}
                        />
                        <div>
                          <Input
                            value={rule.name}
                            onChange={(e) => updateRule(index, "name", e.target.value)}
                            className="font-semibold bg-transparent border-none p-0 h-auto focus-visible:ring-0"
                            placeholder="Nome da regra"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            {rule.triggerDelayHours}h sem resposta → Estilo: {
                              FOLLOWUP_STYLES.find(s => s.value === rule.followupStyle)?.label
                            }
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          Prioridade: {rule.priority || index}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRule(index)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="icon">
                            {expandedRules[index] ? (
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
                      {/* Gatilhos de Tempo */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Clock className="w-4 h-4 text-millennials-yellow" />
                          Gatilho de Tempo
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="space-y-2">
                            <Label>Horas sem resposta</Label>
                            <Input
                              type="number"
                              min={0}
                              value={rule.triggerDelayHours || 24}
                              onChange={(e) => updateRule(index, "triggerDelayHours", parseInt(e.target.value) || 0)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Minutos adicionais</Label>
                            <Input
                              type="number"
                              min={0}
                              max={59}
                              value={rule.triggerDelayMinutes || 0}
                              onChange={(e) => updateRule(index, "triggerDelayMinutes", parseInt(e.target.value) || 0)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Máx. follow-ups</Label>
                            <Input
                              type="number"
                              min={1}
                              max={10}
                              value={rule.maxFollowups || 3}
                              onChange={(e) => updateRule(index, "maxFollowups", parseInt(e.target.value) || 1)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Prioridade</Label>
                            <Input
                              type="number"
                              min={0}
                              value={rule.priority || 0}
                              onChange={(e) => updateRule(index, "priority", parseInt(e.target.value) || 0)}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Filtros de Leads */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Filter className="w-4 h-4 text-millennials-yellow" />
                          Filtros de Leads (com quem atuar)
                        </div>

                        {/* Tags */}
                        <div className="space-y-2">
                          <Label>Tags que o lead DEVE ter (AND)</Label>
                          <div className="flex gap-2">
                            <Input
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              placeholder="Digite uma tag e pressione Enter"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addTag(index, "filterTags");
                                }
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => addTag(index, "filterTags")}
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(rule.filterTags || []).map((tag: string) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="cursor-pointer"
                                onClick={() => removeTag(index, "filterTags", tag)}
                              >
                                {tag} ×
                              </Badge>
                            ))}
                          </div>
                        </div>

                        {/* Pipelines e Etapas */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Pipelines onde atuar</Label>
                            <Select
                              value=""
                              onValueChange={(value) => {
                                const currentPipes = rule.filterPipes || [];
                                if (!currentPipes.includes(value)) {
                                  updateRule(index, "filterPipes", [...currentPipes, value]);
                                }
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione pipelines" />
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
                              {(rule.filterPipes || []).map((pipe: string) => (
                                <Badge
                                  key={pipe}
                                  variant="outline"
                                  className="cursor-pointer"
                                  onClick={() => {
                                    const newPipes = (rule.filterPipes || []).filter((p: string) => p !== pipe);
                                    updateRule(index, "filterPipes", newPipes);
                                  }}
                                >
                                  {PIPE_TYPES.find(p => p.value === pipe)?.label || pipe} ×
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label>Etapas específicas</Label>
                            <Select
                              value=""
                              onValueChange={(value) => {
                                const currentStages = rule.filterStages || [];
                                if (!currentStages.includes(value)) {
                                  updateRule(index, "filterStages", [...currentStages, value]);
                                }
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione etapas" />
                              </SelectTrigger>
                              <SelectContent>
                                {(rule.filterPipes || []).flatMap((pipe: string) =>
                                  (PIPE_STAGES[pipe] || []).map((stage) => (
                                    <SelectItem key={`${pipe}-${stage.value}`} value={stage.value}>
                                      {stage.label}
                                    </SelectItem>
                                  ))
                                )}
                                {(!rule.filterPipes || rule.filterPipes.length === 0) && (
                                  <SelectItem value="__placeholder__" disabled>
                                    Selecione um pipeline primeiro
                                  </SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                            <div className="flex flex-wrap gap-2">
                              {(rule.filterStages || []).map((stage: string) => (
                                <Badge
                                  key={stage}
                                  variant="outline"
                                  className="cursor-pointer"
                                  onClick={() => {
                                    const newStages = (rule.filterStages || []).filter((s: string) => s !== stage);
                                    updateRule(index, "filterStages", newStages);
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
                          Comportamento do Follow-up
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Estilo da mensagem</Label>
                            <Select
                              value={rule.followupStyle || "direct"}
                              onValueChange={(value) => updateRule(index, "followupStyle", value)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FOLLOWUP_STYLES.map((style) => (
                                  <SelectItem key={style.value} value={style.value}>
                                    <div>
                                      <span className="font-medium">{style.label}</span>
                                      <span className="text-xs text-muted-foreground ml-2">
                                        - {style.description}
                                      </span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label>Histórico para análise (dias)</Label>
                            <Input
                              type="number"
                              min={1}
                              max={90}
                              value={rule.contextLookbackDays || 30}
                              onChange={(e) => updateRule(index, "contextLookbackDays", parseInt(e.target.value) || 30)}
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={rule.useLastContext !== false}
                              onCheckedChange={(checked) => updateRule(index, "useLastContext", checked)}
                            />
                            <Label className="cursor-pointer">
                              Usar contexto da última conversa
                            </Label>
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
                                  <p>Use variáveis: {"{nome}"}, {"{empresa}"}, {"{ultimo_assunto}"}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </Label>
                          <Textarea
                            value={rule.messageTemplate || ""}
                            onChange={(e) => updateRule(index, "messageTemplate", e.target.value)}
                            placeholder="Deixe vazio para o agente gerar automaticamente baseado no contexto"
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

                        <div className="flex items-center gap-2 mb-4">
                          <Switch
                            checked={rule.sendOnlyBusinessHours !== false}
                            onCheckedChange={(checked) => updateRule(index, "sendOnlyBusinessHours", checked)}
                          />
                          <Label>Enviar apenas em horário comercial</Label>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4">
                          Se o disparo cair fora do horário ou dos dias configurados, o envio será
                          agendado para o <strong>início do próximo horário comercial</strong>.
                        </p>

                        {rule.sendOnlyBusinessHours !== false && (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                              <Label>Horário início</Label>
                              <Input
                                type="time"
                                value={rule.businessHoursStart || "09:00"}
                                onChange={(e) => updateRule(index, "businessHoursStart", e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Horário fim</Label>
                              <Input
                                type="time"
                                value={rule.businessHoursEnd || "18:00"}
                                onChange={(e) => updateRule(index, "businessHoursEnd", e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Fuso horário</Label>
                              <Select
                                value={rule.timezone || "America/Sao_Paulo"}
                                onValueChange={(value) => updateRule(index, "timezone", value)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="America/Sao_Paulo">São Paulo (GMT-3)</SelectItem>
                                  <SelectItem value="America/Manaus">Manaus (GMT-4)</SelectItem>
                                  <SelectItem value="America/Recife">Recife (GMT-3)</SelectItem>
                                  <SelectItem value="America/Fortaleza">Fortaleza (GMT-3)</SelectItem>
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
                                variant={(rule.sendDays || []).includes(day.value) ? "default" : "outline"}
                                className="cursor-pointer"
                                onClick={() => {
                                  const currentDays = rule.sendDays || [];
                                  if (currentDays.includes(day.value)) {
                                    updateRule(index, "sendDays", currentDays.filter((d: string) => d !== day.value));
                                  } else {
                                    updateRule(index, "sendDays", [...currentDays, day.value]);
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
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Botão adicionar regra */}
      <Button
        type="button"
        variant="outline"
        onClick={addRule}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        Adicionar Regra de Follow-up
      </Button>

      {followupRules.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-muted-foreground">
            <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium">Nenhuma regra de follow-up configurada</p>
            <p className="text-sm mt-1">
              Adicione regras para o agente fazer follow-up automático com leads que não respondem.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
