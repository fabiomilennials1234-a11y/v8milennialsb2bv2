/**
 * Página Principal do Copilot
 *
 * Lista todos os agentes de IA da organização, permitindo:
 * - Visualizar agentes criados
 * - Criar novos agentes (apenas admin com subscription)
 * - Ativar/desativar agentes
 * - Definir agente padrão
 * - Deletar agentes
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Plus,
  Sparkles,
  Bot,
  Power,
  Trash2,
  Star,
  Lock,
  Settings,
  GitBranch,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TorqueLoader } from "@/components/branding/TorqueLoader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useCopilotAgents,
  useDeleteCopilotAgent,
  useToggleCopilotAgent,
  useSetDefaultCopilotAgent,
  useCreateCopilotAgent,
} from "@/hooks/useCopilotAgents";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { BuilderPanel } from "@/components/copilot/builder/BuilderPanel";
import { useCopilotSubscription } from "@/hooks/useCopilotSubscription";
import { useCanManageCopilot } from "@/hooks/useUserRole";
import { useIdentity } from "@/hooks/useIdentity";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { useOrgQuotas } from "@/hooks/useOrgQuotas";
import { toast } from "sonner";
import type { CopilotAgentWithRelations } from "@/types/copilot";

export default function Copilot() {
  const navigate = useNavigate();
  const { data: agents, isLoading } = useCopilotAgents();
  const { hasAccess, isTrial, isLoading: subLoading } =
    useCopilotSubscription();
  const { canManage: canManageCopilot } = useCanManageCopilot();
  const { isMaster } = useIdentity();
  const deleteAgent = useDeleteCopilotAgent();
  const toggleAgent = useToggleCopilotAgent();
  const setDefault = useSetDefaultCopilotAgent();
  const createAgent = useCreateCopilotAgent();
  const { enabled: builderEnabled } = useFeatureFlag("copilot_builder");

  const [agentToDelete, setAgentToDelete] = useState<string | null>(null);
  const [pendingActivation, setPendingActivation] = useState<{ id: string; name: string } | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderAgentId, setBuilderAgentId] = useState<string | undefined>(undefined);
  const { checkLimit } = useOrgFeatures();
  const { getQuota } = useOrgQuotas();
  const copilotQuota = getQuota("max_copilot_agents");

  const handleOpenConfig = (agent: CopilotAgentWithRelations) => {
    navigate(`/copilot/${agent.id}/editar`);
  };

  const handleCreateWithAI = async () => {
    if (!copilotQuota.can_add) {
      toast.error(
        `Limite de agentes atingido (${copilotQuota.current_usage}/${copilotQuota.effective_limit}). Faça upgrade do plano para criar mais.`,
      );
      return;
    }
    try {
      const result = await createAgent.mutateAsync({
        agent: {
          name: "Copilot (rascunho)",
          main_objective: "Em construção com o assistente de IA",
          is_active: false,
          // organization_id + created_by are injected by the mutation hook.
          organization_id: "",
          created_by: "",
        },
        faqs: [],
        kanbanRules: [],
      });
      const newId = (result as { id?: string })?.id;
      if (!newId) throw new Error("Falha ao criar rascunho");
      setBuilderAgentId(newId);
      setBuilderOpen(true);
    } catch (e) {
      toast.error("Não foi possível iniciar o assistente. Tente novamente.");
    }
  };

  const handleCreateAgent = () => {
    // Master sempre tem acesso irrestrito
    if (isMaster) {
      navigate("/copilot/novo");
      return;
    }
    // Membros com permissão ou assinatura ativa podem prosseguir
    if (!canManageCopilot && !hasAccess) {
      navigate("/configuracoes");
      return;
    }
    // Verificar limite de agentes pelo plano (richer quota info)
    if (!copilotQuota.can_add) {
      toast.error(`Limite de agentes atingido (${copilotQuota.current_usage}/${copilotQuota.effective_limit}). Faça upgrade do plano para criar mais.`);
      return;
    }
    navigate("/copilot/novo");
  };

  const handleDeleteAgent = async () => {
    if (agentToDelete) {
      await deleteAgent.mutateAsync(agentToDelete);
      setAgentToDelete(null);
    }
  };

  const handleToggleAgent = (agent: CopilotAgentWithRelations, e: React.MouseEvent) => {
    e.stopPropagation();
    const activating = !agent.is_active;
    const hasNoPipes = !((agent.active_pipes as string[]) || []).length;
    if (activating && hasNoPipes) {
      setPendingActivation({ id: agent.id, name: agent.name });
    } else {
      toggleAgent.mutate({ id: agent.id, isActive: activating });
    }
  };

  if (subLoading || isLoading) {
    return <TorqueLoader variant="full" />;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold">
            Copilot — Agentes de IA
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure e gerencie seus agentes de IA personalizados
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Admin ou membros com a permissão habilitada podem criar copilots e vinculá-los a números em Configurações → WhatsApp. Qualquer membro pode ativar ou desativar a IA em cada conversa.
          </p>
          {!canManageCopilot && (
            <p className="text-xs text-muted-foreground/80 mt-1 max-w-xl">
              Se você não vê o botão &quot;Novo Copilot&quot;, peça ao administrador para liberar a permissão &quot;Criar agente IA&quot; nas configurações de permissões.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!copilotQuota.is_unlimited && (
            <Badge variant="outline" className="text-xs">
              {copilotQuota.current_usage} de {copilotQuota.effective_limit} agentes
            </Badge>
          )}
          <Button
            variant="outline"
            onClick={() => navigate("/copilot/metricas")}
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Métricas LLM
          </Button>
          {canManageCopilot && builderEnabled && (
            <Button
              onClick={handleCreateWithAI}
              variant="outline"
              className="border-primary/40 text-primary hover:bg-primary/10"
              disabled={!copilotQuota.can_add || createAgent.isPending}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Criar com IA
            </Button>
          )}
          {canManageCopilot && (
            <Button
              onClick={handleCreateAgent}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={!copilotQuota.can_add}
            >
              <Plus className="w-4 h-4 mr-2" />
              Novo Copilot
            </Button>
          )}
        </div>
      </motion.div>

      {/* Subscription Warning - Apenas para quem não tem acesso */}
      {!canManageCopilot && (isTrial || !hasAccess) && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card className="border-primary bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <Lock className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
                <div>
                  <h3 className="font-semibold mb-1">
                    Recurso Exclusivo para Assinantes
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    O Copilot está disponível apenas para planos pagos. Faça
                    upgrade para desbloquear este recurso e criar agentes de IA
                    personalizados.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => navigate("/configuracoes")}
                  >
                    Ver Planos
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Agents List */}
      {agents && agents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent, index) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.02 }}
            >
              <Card
                  className="h-full cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => handleOpenConfig(agent)}
                >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Bot className="w-5 h-5 text-primary" />
                      <CardTitle className="text-lg">{agent.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1">
                      {agent.is_default && (
                        <Star className="w-4 h-4 fill-primary text-primary" />
                      )}
                      {agent.is_active ? (
                        <Badge className="bg-success text-success-foreground">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary">Inativo</Badge>
                      )}
                    </div>
                  </div>
                  <CardDescription className="capitalize">
                    {agent.template_type}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <span className="text-sm text-muted-foreground">
                      Personalidade:
                    </span>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {agent.personality_tone}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {agent.personality_style}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {agent.personality_energy}
                      </Badge>
                    </div>
                  </div>

                  <div>
                    <span className="text-sm text-muted-foreground">
                      Habilidades:
                    </span>
                    <p className="text-sm">
                      {agent.skills?.length || 0} configuradas
                    </p>
                  </div>

                  {/* Pipeline Info */}
                  <div>
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />
                      Funis ativos:
                    </span>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {((agent.active_pipes as string[]) || []).length > 0 ? (
                        ((agent.active_pipes as string[]) || []).map((pipe) => (
                          <Badge key={pipe} variant="secondary" className="text-xs capitalize">
                            {pipe}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-amber-500 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Nenhum funil — configure antes de ativar
                        </span>
                      )}
                    </div>
                  </div>

                  {canManageCopilot && (
                    <div className="flex gap-2 pt-4 border-t flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenConfig(agent);
                        }}
                      >
                        <Settings className="w-4 h-4 mr-2" />
                        Configurar
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => handleToggleAgent(agent, e)}
                        disabled={toggleAgent.isPending}
                      >
                        <Power className="w-4 h-4 mr-2" />
                        {agent.is_active ? "Desativar" : "Ativar"}
                      </Button>

                      {!agent.is_default && agent.is_active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDefault.mutate(agent.id);
                          }}
                          disabled={setDefault.isPending}
                        >
                          <Star className="w-4 h-4 mr-2" />
                          Padrão
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAgentToDelete(agent.id);
                        }}
                        disabled={deleteAgent.isPending}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card>
            <CardContent className="py-16 text-center">
              <Bot className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">
                Nenhum Copilot configurado
              </h3>
              <p className="text-muted-foreground mb-6">
                Crie seu primeiro agente de IA para começar a automatizar suas
                vendas
              </p>
              {canManageCopilot && (
                <Button
                  onClick={handleCreateAgent}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Criar Primeiro Copilot
                </Button>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!agentToDelete}
        onOpenChange={() => setAgentToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar este agente? Esta ação não pode
              ser desfeita. Todos os dados relacionados (FAQs, regras do Kanban)
              também serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAgent}
              className="bg-destructive hover:bg-destructive/90"
            >
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Activation without pipes — confirmation dialog */}
      <AlertDialog
        open={!!pendingActivation}
        onOpenChange={() => setPendingActivation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Agente sem funis configurados
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                O agente <strong>{pendingActivation?.name}</strong> ainda não tem funis configurados. Ativado assim, ele pode responder a todos os leads da organização sem roteamento.
              </span>
              <span className="block">
                Recomendado: clique em <strong>Configurar</strong> e defina em quais funis o agente deve atuar antes de ativar.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingActivation(null)}>
              Cancelar — vou configurar primeiro
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingActivation) {
                  toggleAgent.mutate({ id: pendingActivation.id, isActive: true });
                  setPendingActivation(null);
                }
              }}
            >
              Ativar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {builderEnabled && (
        <BuilderPanel
          agentId={builderAgentId}
          open={builderOpen}
          onOpenChange={setBuilderOpen}
        />
      )}

    </div>
  );
}
