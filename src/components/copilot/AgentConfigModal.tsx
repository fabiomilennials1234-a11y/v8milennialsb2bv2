/**
 * Modal de Configuração do Agente Copilot
 *
 * Permite editar as configurações do agente e definir:
 * - Em quais funis/etapas o agente está ativo
 * - Se pode movimentar cards automaticamente
 * - Regras de movimentação quando qualifica ou cumpre objetivo
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Settings,
  GitBranch,
  ArrowRightLeft,
  Plus,
  Trash2,
  X,
  Save,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Smartphone,
  Link2,
  Unlink,
  BarChart3,
  Clock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useUpdateCopilotAgentPipeline, useLinkAgentToWhatsAppInstance } from "@/hooks/useCopilotAgents";
import { useWhatsAppInstancesWithAgent } from "@/hooks/useWhatsAppInstances";
import type { CopilotAgentWithRelations, MoveRule } from "@/types/copilot";
import { PIPE_TYPES, PIPE_STAGES } from "@/types/copilot";
import { AgentMetricsTab } from "./AgentMetricsTab";
import { AgentTasksTab } from "./AgentTasksTab";
import { AgentFollowupRulesTab } from "./AgentFollowupRulesTab";

interface AgentConfigModalProps {
  agent: CopilotAgentWithRelations | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentConfigModal({
  agent,
  open,
  onOpenChange,
}: AgentConfigModalProps) {
  const updatePipeline = useUpdateCopilotAgentPipeline();
  const linkToWhatsApp = useLinkAgentToWhatsAppInstance();
  const { data: whatsappInstances = [], isLoading: isLoadingInstances } = useWhatsAppInstancesWithAgent();

  // Estado local para edição
  const [activePipes, setActivePipes] = useState<string[]>([]);
  const [activeStages, setActiveStages] = useState<Record<string, string[]>>({});
  const [canMoveCards, setCanMoveCards] = useState(false);
  const [autoMoveOnQualify, setAutoMoveOnQualify] = useState(false);
  const [autoMoveOnObjective, setAutoMoveOnObjective] = useState(false);
  const [moveRules, setMoveRules] = useState<MoveRule[]>([]);
  const [expandedPipes, setExpandedPipes] = useState<Record<string, boolean>>({});
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  // Carregar dados do agente quando abrir
  useEffect(() => {
    if (agent && open) {
      setActivePipes((agent.active_pipes as string[]) || []);
      setActiveStages((agent.active_stages as Record<string, string[]>) || {});
      setCanMoveCards(agent.can_move_cards || false);
      setAutoMoveOnQualify(agent.auto_move_on_qualify || false);
      setAutoMoveOnObjective(agent.auto_move_on_objective || false);
      setMoveRules((agent.move_rules as MoveRule[]) || []);
      // @ts-ignore - campo adicionado na migração
      setSelectedInstanceId(agent.whatsapp_instance_id || null);

      // Expandir pipes ativos por padrão
      const expanded: Record<string, boolean> = {};
      ((agent.active_pipes as string[]) || []).forEach((pipe) => {
        expanded[pipe] = true;
      });
      setExpandedPipes(expanded);
    }
  }, [agent, open]);

  // Handlers para WhatsApp
  const handleLinkWhatsApp = async (instanceId: string) => {
    if (!agent) return;
    await linkToWhatsApp.mutateAsync({ agentId: agent.id, instanceId });
    setSelectedInstanceId(instanceId);
  };

  const handleUnlinkWhatsApp = async () => {
    if (!agent) return;
    await linkToWhatsApp.mutateAsync({ agentId: agent.id, instanceId: null });
    setSelectedInstanceId(null);
  };

  const handleTogglePipe = (pipeValue: string) => {
    setActivePipes((prev) => {
      if (prev.includes(pipeValue)) {
        // Remover pipe e suas stages
        setActiveStages((stages) => {
          const newStages = { ...stages };
          delete newStages[pipeValue];
          return newStages;
        });
        return prev.filter((p) => p !== pipeValue);
      } else {
        // Adicionar pipe
        setExpandedPipes((exp) => ({ ...exp, [pipeValue]: true }));
        return [...prev, pipeValue];
      }
    });
  };

  const handleToggleStage = (pipe: string, stage: string) => {
    setActiveStages((prev) => {
      const pipeStages = prev[pipe] || [];
      if (pipeStages.includes(stage)) {
        return {
          ...prev,
          [pipe]: pipeStages.filter((s) => s !== stage),
        };
      } else {
        return {
          ...prev,
          [pipe]: [...pipeStages, stage],
        };
      }
    });
  };

  const handleSelectAllStages = (pipe: string) => {
    const allStages = PIPE_STAGES[pipe]?.map((s) => s.value) || [];
    setActiveStages((prev) => ({
      ...prev,
      [pipe]: allStages,
    }));
  };

  const handleClearAllStages = (pipe: string) => {
    setActiveStages((prev) => ({
      ...prev,
      [pipe]: [],
    }));
  };

  const handleAddMoveRule = () => {
    setMoveRules((prev) => [
      ...prev,
      {
        from: { pipe: "", stage: "" },
        to: { pipe: "", stage: "" },
        condition: "qualified",
      },
    ]);
  };

  const handleRemoveMoveRule = (index: number) => {
    setMoveRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateMoveRule = (
    index: number,
    field: "from" | "to" | "condition",
    value: any
  ) => {
    setMoveRules((prev) =>
      prev.map((rule, i) => {
        if (i !== index) return rule;
        if (field === "condition") {
          return { ...rule, condition: value };
        }
        return { ...rule, [field]: value };
      })
    );
  };

  const handleSave = async () => {
    if (!agent) return;

    await updatePipeline.mutateAsync({
      id: agent.id,
      activePipes,
      activeStages,
      canMoveCards,
      autoMoveOnQualify,
      autoMoveOnObjective,
      moveRules,
    });

    onOpenChange(false);
  };

  if (!agent) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-millennials-yellow" />
            Configurar Copilot: {agent.name}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="overview" className="flex-1">
          <TabsList className={`grid w-full ${agent.template_type === 'followup' ? 'grid-cols-6' : 'grid-cols-5'}`}>
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Visão Geral</span>
              <span className="sm:hidden">Geral</span>
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">WhatsApp</span>
              <span className="sm:hidden">WhatsApp</span>
            </TabsTrigger>
            <TabsTrigger value="pipelines" className="flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              <span className="hidden sm:inline">Funis</span>
              <span className="sm:hidden">Funis</span>
            </TabsTrigger>
            <TabsTrigger value="automation" className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Automação</span>
              <span className="sm:hidden">Auto</span>
            </TabsTrigger>
            <TabsTrigger value="review" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline">Revisão</span>
              <span className="sm:hidden">Rev</span>
            </TabsTrigger>
            {agent.template_type === 'followup' && (
              <TabsTrigger value="followup" className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span className="hidden sm:inline">Follow-up</span>
                <span className="sm:hidden">FU</span>
              </TabsTrigger>
            )}
          </TabsList>

          <ScrollArea className="h-[60vh] mt-4">
            {/* Tab: Visão Geral */}
            <TabsContent value="overview" className="space-y-4 px-1">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Informações do Agente</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Nome</Label>
                      <p className="font-medium">{agent.name}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Template</Label>
                      <Badge variant="outline" className="capitalize">
                        {agent.template_type}
                      </Badge>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Status</Label>
                      <Badge
                        className={
                          agent.is_active
                            ? "bg-green-500"
                            : "bg-muted text-muted-foreground"
                        }
                      >
                        {agent.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Padrão</Label>
                      <Badge variant={agent.is_default ? "default" : "outline"}>
                        {agent.is_default ? "Sim" : "Não"}
                      </Badge>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <Label className="text-muted-foreground">Personalidade</Label>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <Badge variant="outline">{agent.personality_tone}</Badge>
                      <Badge variant="outline">{agent.personality_style}</Badge>
                      <Badge variant="outline">{agent.personality_energy}</Badge>
                    </div>
                  </div>

                  <div>
                    <Label className="text-muted-foreground">Objetivo Principal</Label>
                    <p className="text-sm mt-1">{agent.main_objective}</p>
                  </div>

                  <div>
                    <Label className="text-muted-foreground">Habilidades</Label>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {(agent.skills as string[] || []).map((skill, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: WhatsApp */}
            <TabsContent value="whatsapp" className="space-y-4 px-1">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Smartphone className="w-5 h-5" />
                    Vincular ao WhatsApp
                  </CardTitle>
                  <CardDescription>
                    Selecione uma instância de WhatsApp para o agente responder automaticamente.
                    Quando vinculado, todas as mensagens recebidas nessa instância serão processadas pelo agente.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Instância atualmente vinculada */}
                  {selectedInstanceId && (
                    <div className="p-4 border rounded-lg bg-green-500/10 border-green-500/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                            <Link2 className="w-5 h-5 text-green-500" />
                          </div>
                          <div>
                            <p className="font-medium">
                              {whatsappInstances.find(i => i.id === selectedInstanceId)?.instance_name || "Instância"}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Agente vinculado e respondendo automaticamente
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleUnlinkWhatsApp}
                          disabled={linkToWhatsApp.isPending}
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                        >
                          <Unlink className="w-4 h-4 mr-2" />
                          Desvincular
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Lista de instâncias disponíveis */}
                  {!selectedInstanceId && (
                    <>
                      {isLoadingInstances ? (
                        <div className="text-center py-8 text-muted-foreground">
                          Carregando instâncias...
                        </div>
                      ) : whatsappInstances.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Smartphone className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p>Nenhuma instância de WhatsApp encontrada</p>
                          <p className="text-sm">
                            Crie uma instância na página de WhatsApp para vincular ao agente
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label className="text-sm text-muted-foreground">
                            Selecione uma instância para vincular:
                          </Label>
                          {whatsappInstances.map((instance) => {
                            const isConnected = instance.status === "connected";
                            // @ts-ignore
                            const hasOtherAgent = instance.copilot_agent_id && instance.copilot_agent_id !== agent?.id;
                            
                            return (
                              <div
                                key={instance.id}
                                className={`p-4 border rounded-lg transition-colors ${
                                  hasOtherAgent
                                    ? "opacity-50 cursor-not-allowed"
                                    : "hover:bg-muted/50 cursor-pointer"
                                }`}
                                onClick={() => !hasOtherAgent && handleLinkWhatsApp(instance.id)}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                      isConnected ? "bg-green-500/20" : "bg-yellow-500/20"
                                    }`}>
                                      <Smartphone className={`w-5 h-5 ${
                                        isConnected ? "text-green-500" : "text-yellow-500"
                                      }`} />
                                    </div>
                                    <div>
                                      <p className="font-medium">{instance.instance_name}</p>
                                      <div className="flex items-center gap-2">
                                        <Badge variant={isConnected ? "default" : "secondary"} className="text-xs">
                                          {isConnected ? "Conectado" : instance.status}
                                        </Badge>
                                        {instance.phone_number && (
                                          <span className="text-xs text-muted-foreground">
                                            {instance.phone_number}
                                          </span>
                                        )}
                                        {hasOtherAgent && (
                                          <Badge variant="outline" className="text-xs">
                                            Já vinculado a outro agente
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  {!hasOtherAgent && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={linkToWhatsApp.isPending}
                                    >
                                      <Link2 className="w-4 h-4 mr-2" />
                                      Vincular
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}

                  <Separator />

                  <div className="text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg">
                    <p className="font-medium mb-2">Como funciona:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Quando um lead envia mensagem na instância vinculada, o agente processa e responde automaticamente</li>
                      <li>O agente cria leads automaticamente para novos contatos</li>
                      <li>Áudios e imagens podem ser interpretados e resumidos para a IA quando configurado</li>
                      <li>Você pode desvincular a qualquer momento para pausar as respostas automáticas</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Funis & Etapas */}
            <TabsContent value="pipelines" className="space-y-4 px-1">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Funis Ativos</CardTitle>
                  <CardDescription>
                    Selecione em quais funis e etapas o agente deve atuar
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {PIPE_TYPES.map((pipe) => {
                    const isActive = activePipes.includes(pipe.value);
                    const isExpanded = expandedPipes[pipe.value];
                    const pipeStages = activeStages[pipe.value] || [];

                    return (
                      <div
                        key={pipe.value}
                        className="border rounded-lg overflow-hidden"
                      >
                        <div
                          className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${
                            isActive ? "bg-millennials-yellow/10" : "hover:bg-muted/50"
                          }`}
                          onClick={() => handleTogglePipe(pipe.value)}
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={isActive}
                              onCheckedChange={() => handleTogglePipe(pipe.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="font-medium">{pipe.label}</span>
                            {isActive && pipeStages.length > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                {pipeStages.length} etapas
                              </Badge>
                            )}
                          </div>
                          {isActive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedPipes((prev) => ({
                                  ...prev,
                                  [pipe.value]: !prev[pipe.value],
                                }));
                              }}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </Button>
                          )}
                        </div>

                        <AnimatePresence>
                          {isActive && isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="p-4 pt-0 border-t bg-muted/30">
                                <div className="flex justify-between items-center mb-3">
                                  <Label className="text-sm text-muted-foreground">
                                    Etapas onde o agente atuará:
                                  </Label>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleSelectAllStages(pipe.value)}
                                    >
                                      Todas
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleClearAllStages(pipe.value)}
                                    >
                                      Limpar
                                    </Button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                  {PIPE_STAGES[pipe.value]?.map((stage) => (
                                    <div
                                      key={stage.value}
                                      className="flex items-center gap-2"
                                    >
                                      <Checkbox
                                        id={`${pipe.value}-${stage.value}`}
                                        checked={pipeStages.includes(stage.value)}
                                        onCheckedChange={() =>
                                          handleToggleStage(pipe.value, stage.value)
                                        }
                                      />
                                      <Label
                                        htmlFor={`${pipe.value}-${stage.value}`}
                                        className="text-sm cursor-pointer"
                                      >
                                        {stage.label}
                                      </Label>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Automação */}
            <TabsContent value="automation" className="space-y-4 px-1">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Permissões de Movimentação</CardTitle>
                  <CardDescription>
                    Configure se o agente pode movimentar cards automaticamente
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Pode movimentar cards</Label>
                      <p className="text-sm text-muted-foreground">
                        Permite que o agente mova leads entre etapas e funis
                      </p>
                    </div>
                    <Switch
                      checked={canMoveCards}
                      onCheckedChange={setCanMoveCards}
                    />
                  </div>

                  <AnimatePresence>
                    {canMoveCards && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="space-y-4 overflow-hidden"
                      >
                        <Separator />

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label>Mover ao qualificar</Label>
                            <p className="text-sm text-muted-foreground">
                              Move automaticamente quando o agente qualifica o lead
                            </p>
                          </div>
                          <Switch
                            checked={autoMoveOnQualify}
                            onCheckedChange={setAutoMoveOnQualify}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label>Mover ao cumprir objetivo</Label>
                            <p className="text-sm text-muted-foreground">
                              Move automaticamente quando o agente cumpre seu objetivo
                            </p>
                          </div>
                          <Switch
                            checked={autoMoveOnObjective}
                            onCheckedChange={setAutoMoveOnObjective}
                          />
                        </div>

                        <Separator />

                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <Label>Regras de Movimentação</Label>
                              <p className="text-sm text-muted-foreground">
                                Defina para onde mover o lead em cada condição
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleAddMoveRule}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Adicionar Regra
                            </Button>
                          </div>

                          <div className="space-y-4">
                            {moveRules.map((rule, index) => (
                              <Card key={index} className="bg-muted/30">
                                <CardContent className="pt-4">
                                  <div className="flex items-start gap-4">
                                    <div className="flex-1 grid grid-cols-2 gap-4">
                                      {/* Origem */}
                                      <div className="space-y-2">
                                        <Label className="text-xs text-muted-foreground">
                                          DE (Origem)
                                        </Label>
                                        <Select
                                          value={rule.from.pipe}
                                          onValueChange={(value) =>
                                            handleUpdateMoveRule(index, "from", {
                                              pipe: value,
                                              stage: "",
                                            })
                                          }
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Funil" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {PIPE_TYPES.map((pipe) => (
                                              <SelectItem
                                                key={pipe.value}
                                                value={pipe.value}
                                              >
                                                {pipe.label}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        {rule.from.pipe && (
                                          <Select
                                            value={rule.from.stage}
                                            onValueChange={(value) =>
                                              handleUpdateMoveRule(index, "from", {
                                                ...rule.from,
                                                stage: value,
                                              })
                                            }
                                          >
                                            <SelectTrigger>
                                              <SelectValue placeholder="Etapa" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {PIPE_STAGES[rule.from.pipe]?.map(
                                                (stage) => (
                                                  <SelectItem
                                                    key={stage.value}
                                                    value={stage.value}
                                                  >
                                                    {stage.label}
                                                  </SelectItem>
                                                )
                                              )}
                                            </SelectContent>
                                          </Select>
                                        )}
                                      </div>

                                      {/* Destino */}
                                      <div className="space-y-2">
                                        <Label className="text-xs text-muted-foreground">
                                          PARA (Destino)
                                        </Label>
                                        <Select
                                          value={rule.to.pipe}
                                          onValueChange={(value) =>
                                            handleUpdateMoveRule(index, "to", {
                                              pipe: value,
                                              stage: "",
                                            })
                                          }
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Funil" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {PIPE_TYPES.map((pipe) => (
                                              <SelectItem
                                                key={pipe.value}
                                                value={pipe.value}
                                              >
                                                {pipe.label}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        {rule.to.pipe && (
                                          <Select
                                            value={rule.to.stage}
                                            onValueChange={(value) =>
                                              handleUpdateMoveRule(index, "to", {
                                                ...rule.to,
                                                stage: value,
                                              })
                                            }
                                          >
                                            <SelectTrigger>
                                              <SelectValue placeholder="Etapa" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {PIPE_STAGES[rule.to.pipe]?.map(
                                                (stage) => (
                                                  <SelectItem
                                                    key={stage.value}
                                                    value={stage.value}
                                                  >
                                                    {stage.label}
                                                  </SelectItem>
                                                )
                                              )}
                                            </SelectContent>
                                          </Select>
                                        )}
                                      </div>

                                      {/* Condição */}
                                      <div className="col-span-2 space-y-2">
                                        <Label className="text-xs text-muted-foreground">
                                          Condição para mover
                                        </Label>
                                        <Select
                                          value={rule.condition}
                                          onValueChange={(value) =>
                                            handleUpdateMoveRule(
                                              index,
                                              "condition",
                                              value
                                            )
                                          }
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Selecione" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="qualified">
                                              Quando qualificar o lead
                                            </SelectItem>
                                            <SelectItem value="objective_met">
                                              Quando cumprir o objetivo
                                            </SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>

                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => handleRemoveMoveRule(index)}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}

                            {moveRules.length === 0 && (
                              <div className="text-center py-8 text-muted-foreground">
                                <ArrowRightLeft className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                <p>Nenhuma regra de movimentação configurada</p>
                                <p className="text-sm">
                                  Adicione regras para definir como o agente deve
                                  mover os leads
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Revisão & Métricas */}
            <TabsContent value="review" className="space-y-4 px-1">
              <Tabs defaultValue="metrics" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="metrics">Métricas</TabsTrigger>
                  <TabsTrigger value="tasks">Tarefas Pendentes</TabsTrigger>
                </TabsList>
                <TabsContent value="metrics" className="mt-4">
                  <AgentMetricsTab agentId={agent.id} />
                </TabsContent>
                <TabsContent value="tasks" className="mt-4">
                  <AgentTasksTab agentId={agent.id} />
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* Tab: Follow-up Rules (apenas para agentes do tipo "followup") */}
            {agent.template_type === 'followup' && (
              <TabsContent value="followup" className="space-y-4 px-1">
                <AgentFollowupRulesTab agentId={agent.id} />
              </TabsContent>
            )}
          </ScrollArea>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4 mr-2" />
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={updatePipeline.isPending}
            className="bg-millennials-yellow hover:bg-millennials-yellow/90 text-black"
          >
            <Save className="w-4 h-4 mr-2" />
            {updatePipeline.isPending ? "Salvando..." : "Salvar Configurações"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
