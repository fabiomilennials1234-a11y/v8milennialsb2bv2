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
  Bot,
  Power,
  Trash2,
  Star,
  Lock,
  Loader2,
  Settings,
  GitBranch,
  BarChart3,
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
} from "@/hooks/useCopilotAgents";
import { useCopilotSubscription } from "@/hooks/useCopilotSubscription";
import { useCanManageCopilot } from "@/hooks/useUserRole";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { toast } from "sonner";
import { AgentConfigModal } from "@/components/copilot/AgentConfigModal";
import type { CopilotAgentWithRelations } from "@/types/copilot";

export default function Copilot() {
  const navigate = useNavigate();
  const { data: agents, isLoading } = useCopilotAgents();
  const { hasAccess, isTrial, isLoading: subLoading } =
    useCopilotSubscription();
  const { canManage: canManageCopilot } = useCanManageCopilot();
  const { isMaster } = useMasterAuth();
  const deleteAgent = useDeleteCopilotAgent();
  const toggleAgent = useToggleCopilotAgent();
  const setDefault = useSetDefaultCopilotAgent();

  const [agentToDelete, setAgentToDelete] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<CopilotAgentWithRelations | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const { checkLimit } = useOrgFeatures();

  const handleOpenConfig = (agent: CopilotAgentWithRelations) => {
    setSelectedAgent(agent);
    setConfigModalOpen(true);
  };

  const handleCreateAgent = () => {
    // Master sempre tem acesso irrestrito
    if (isMaster) {
      navigate("/copilot/novo");
      return;
    }
    // Admins e closers sempre têm acesso; outros precisam de assinatura ativa
    if (!canManageCopilot && !hasAccess) {
      navigate("/configuracoes");
      return;
    }
    // Verificar limite de agentes pelo plano
    const maxAgents = checkLimit("max_copilot_agents");
    if (maxAgents !== -1 && (agents?.length ?? 0) >= maxAgents) {
      toast.error(`Limite de ${maxAgents} agente(s) atingido. Faça upgrade do plano para criar mais.`);
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

  if (subLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
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
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Bot className="w-8 h-8 text-primary" />
            Copilot - Agentes de IA
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure e gerencie seus agentes de IA personalizados
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Admin e Closers podem criar copilots e vincular a números em Configurações → WhatsApp. SDRs podem ativar ou desativar a IA em cada conversa (toggle no chat, painel do lead ou card no funil).
          </p>
          {!canManageCopilot && (
            <p className="text-xs text-muted-foreground/80 mt-1 max-w-xl">
              Se você é Closer ou Admin na equipe e não vê o botão &quot;Novo Copilot&quot;, peça ao admin para conferir sua role em Pitstop → Equipe.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/copilot/metricas")}
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Métricas LLM
          </Button>
          {canManageCopilot && (
            <Button
              onClick={handleCreateAgent}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
                        <Badge className="bg-green-500">Ativo</Badge>
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
                        <span className="text-xs text-muted-foreground">
                          Nenhum configurado
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
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleAgent.mutate({
                            id: agent.id,
                            isActive: !agent.is_active,
                          });
                        }}
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

      {/* Agent Config Modal */}
      <AgentConfigModal
        agent={selectedAgent}
        open={configModalOpen}
        onOpenChange={setConfigModalOpen}
      />
    </div>
  );
}
