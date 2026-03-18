/**
 * Modal de Configuração do Agente Copilot
 *
 * Simplificado para 2 tabs:
 * - Geral: informações do agente + vincular WhatsApp
 * - Funis: em quais funis/etapas o agente está ativo (padrão + custom)
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Settings,
  GitBranch,
  X,
  Save,
  ChevronDown,
  ChevronRight,
  Smartphone,
  Link2,
  Unlink,
  Pencil,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useNavigate } from "react-router-dom";
import { useUpdateCopilotAgentPipeline, useLinkAgentToWhatsAppInstance } from "@/hooks/useCopilotAgents";
import { useWhatsAppInstancesWithAgent } from "@/hooks/useWhatsAppInstances";
import type { CopilotAgentWithRelations, MoveRule } from "@/types/copilot";
import { PIPE_TYPES } from "@/types/copilot";
import { useAllPipelineStageOptions } from "@/hooks/usePipelineStages";
import { useCustomPipelines, useCustomPipelineStages } from "@/hooks/useCustomPipelines";

// ── Sub-componente para custom pipeline rows (hooks não podem ser chamados em .map()) ──

function CustomPipeRow({
  pipeline,
  isActive,
  isExpanded,
  pipeStages,
  onTogglePipe,
  onToggleExpand,
  onToggleStage,
  onSelectAll,
  onClearAll,
}: {
  pipeline: { id: string; name: string };
  isActive: boolean;
  isExpanded: boolean;
  pipeStages: string[];
  onTogglePipe: () => void;
  onToggleExpand: () => void;
  onToggleStage: (stage: string) => void;
  onSelectAll: (stages: string[]) => void;
  onClearAll: () => void;
}) {
  const { data: stages = [] } = useCustomPipelineStages(pipeline.id);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${
          isActive ? "bg-primary/10" : "hover:bg-muted/50"
        }`}
        onClick={onTogglePipe}
      >
        <div className="flex items-center gap-3">
          <Checkbox
            checked={isActive}
            onCheckedChange={onTogglePipe}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="font-medium">{pipeline.name}</span>
          <Badge variant="outline" className="text-xs">Custom</Badge>
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
              onToggleExpand();
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
        {isActive && isExpanded && stages.length > 0 && (
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
                    onClick={() => onSelectAll(stages.map((s) => s.stage_key))}
                  >
                    Todas
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onClearAll}>
                    Limpar
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {stages.map((stage) => (
                  <div key={stage.stage_key} className="flex items-center gap-2">
                    <Checkbox
                      id={`custom-${pipeline.id}-${stage.stage_key}`}
                      checked={pipeStages.includes(stage.stage_key)}
                      onCheckedChange={() => onToggleStage(stage.stage_key)}
                    />
                    <Label
                      htmlFor={`custom-${pipeline.id}-${stage.stage_key}`}
                      className="text-sm cursor-pointer"
                    >
                      {stage.name}
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
}

// ── Modal principal ──

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
  const navigate = useNavigate();
  const updatePipeline = useUpdateCopilotAgentPipeline();
  const linkToWhatsApp = useLinkAgentToWhatsAppInstance();
  const { data: whatsappInstances = [], isLoading: isLoadingInstances } = useWhatsAppInstancesWithAgent();
  const { stagesByPipe } = useAllPipelineStageOptions();
  const { data: customPipelines = [] } = useCustomPipelines();

  // Estado local para edição
  const [activePipes, setActivePipes] = useState<string[]>([]);
  const [activeStages, setActiveStages] = useState<Record<string, string[]>>({});
  // Preservar estado de automação para handleSave (não editável neste modal)
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
        setActiveStages((stages) => {
          const newStages = { ...stages };
          delete newStages[pipeValue];
          return newStages;
        });
        return prev.filter((p) => p !== pipeValue);
      } else {
        setExpandedPipes((exp) => ({ ...exp, [pipeValue]: true }));
        return [...prev, pipeValue];
      }
    });
  };

  const handleToggleStage = (pipe: string, stage: string) => {
    setActiveStages((prev) => {
      const pipeStages = prev[pipe] || [];
      if (pipeStages.includes(stage)) {
        return { ...prev, [pipe]: pipeStages.filter((s) => s !== stage) };
      } else {
        return { ...prev, [pipe]: [...pipeStages, stage] };
      }
    });
  };

  const handleSelectAllStages = (pipe: string) => {
    const allStages = (stagesByPipe[pipe] || []).map((s) => s.value);
    setActiveStages((prev) => ({ ...prev, [pipe]: allStages }));
  };

  const handleClearAllStages = (pipe: string) => {
    setActiveStages((prev) => ({ ...prev, [pipe]: [] }));
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
            <Bot className="w-5 h-5 text-primary" />
            Configurar Copilot: {agent.name}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="overview" className="flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="pipelines" className="flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              Funis
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[60vh] mt-4">
            {/* Tab: Geral (Visão Geral + WhatsApp) */}
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

              {/* Seção WhatsApp */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Smartphone className="w-5 h-5" />
                    Instância WhatsApp
                  </CardTitle>
                  <CardDescription>
                    Vincule uma instância de WhatsApp para o agente responder automaticamente.
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
                  {/* Pipes padrão */}
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
                            isActive ? "bg-primary/10" : "hover:bg-muted/50"
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
                                  {(stagesByPipe[pipe.value] || [])?.map((stage) => (
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

                  {/* Custom Pipelines */}
                  {customPipelines.length > 0 && (
                    <>
                      <Separator className="my-4" />
                      <Label className="text-sm font-medium text-muted-foreground mb-2 block">
                        Pipes Custom
                      </Label>
                      {customPipelines.map((pipeline) => (
                        <CustomPipeRow
                          key={pipeline.id}
                          pipeline={pipeline}
                          isActive={activePipes.includes(pipeline.id)}
                          isExpanded={expandedPipes[pipeline.id] || false}
                          pipeStages={activeStages[pipeline.id] || []}
                          onTogglePipe={() => handleTogglePipe(pipeline.id)}
                          onToggleExpand={() =>
                            setExpandedPipes((prev) => ({
                              ...prev,
                              [pipeline.id]: !prev[pipeline.id],
                            }))
                          }
                          onToggleStage={(stage) => handleToggleStage(pipeline.id, stage)}
                          onSelectAll={(stages) =>
                            setActiveStages((prev) => ({
                              ...prev,
                              [pipeline.id]: stages,
                            }))
                          }
                          onClearAll={() =>
                            setActiveStages((prev) => ({
                              ...prev,
                              [pipeline.id]: [],
                            }))
                          }
                        />
                      ))}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              navigate(`/copilot/${agent.id}/editar`);
            }}
          >
            <Pencil className="w-4 h-4 mr-2" />
            Editar Copilot
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="w-4 h-4 mr-2" />
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={updatePipeline.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Save className="w-4 h-4 mr-2" />
              {updatePipeline.isPending ? "Salvando..." : "Salvar Configurações"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
