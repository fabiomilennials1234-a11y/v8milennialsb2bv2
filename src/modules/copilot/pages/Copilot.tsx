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
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
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
  useDraftCopilotAgents,
} from "@/modules/copilot/hooks/useCopilotAgents";
import { useCopilotSubscription } from "@/modules/copilot/hooks/useCopilotSubscription";
import { useFeatureFlag } from "@/modules/platform";
import { useCanManageCopilot } from "@/modules/identity";
import { useIdentity } from "@/modules/identity";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { useOrgQuotas } from "@/modules/identity";
import { toast } from "sonner";
import type { CopilotAgentWithRelations } from "@/types/copilot";
import { useCopilotFunnelOptions } from "@/modules/copilot/hooks/usePipeTypeOptions";
import { cn } from "@/lib/utils";

/** Rótulo micro do V5 — nome de campo dentro do cartão. */
const MICRO_LABEL = "text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground";

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
  const { data: drafts = [] } = useDraftCopilotAgents();
  const { labelForRef } = useCopilotFunnelOptions();

  const [agentToDelete, setAgentToDelete] = useState<string | null>(null);
  const [pendingActivation, setPendingActivation] = useState<{ id: string; name: string } | null>(null);
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
      navigate(`/copilot/${newId}/editar?builder=1`);
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
    <div className="space-y-5">
      <PageHeader
        title="Copilot"
        subtitle="Configure e gerencie seus agentes de IA personalizados."
        actions={
          <>
            {!copilotQuota.is_unlimited && (
              <Badge variant="soft" className="tabular-nums">
                {copilotQuota.current_usage} de {copilotQuota.effective_limit} agentes
              </Badge>
            )}
            <Button variant="outline" onClick={() => navigate("/copilot/metricas")}>
              <BarChart3 />
              Métricas LLM
            </Button>
            {canManageCopilot && builderEnabled && (
              <Button
                onClick={handleCreateWithAI}
                variant="ink"
                disabled={!copilotQuota.can_add || createAgent.isPending}
              >
                <Sparkles />
                Criar com IA
              </Button>
            )}
            {canManageCopilot && (
              <Button onClick={handleCreateAgent} disabled={!copilotQuota.can_add}>
                <Plus />
                Novo Copilot
              </Button>
            )}
          </>
        }
      />

      <div className="-mt-1 max-w-2xl space-y-1 text-xs leading-relaxed text-muted-foreground">
        <p>
          Admin ou membros com a permissão habilitada podem criar copilots e vinculá-los a números em Configurações → WhatsApp. Qualquer membro pode ativar ou desativar a IA em cada conversa.
        </p>
        {!canManageCopilot && (
          <p className="text-muted-foreground/80">
            Se você não vê o botão &quot;Novo Copilot&quot;, peça ao administrador para liberar a permissão &quot;Criar agente IA&quot; nas configurações de permissões.
          </p>
        )}
      </div>

      {builderEnabled && drafts.length > 0 && (
        <section className="flex flex-col gap-3 rounded-card border border-primary/25 bg-primary-soft/60 p-4 shadow-relevo">
          <div className="flex items-center gap-2.5 text-sm font-bold text-foreground">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary-soft-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            {drafts.length === 1
              ? "Você tem um Copilot em construção"
              : `Você tem ${drafts.length} Copilots em construção`}
          </div>
          <ul className="flex flex-col gap-1">
            {drafts.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-card/70 px-3 py-1.5"
              >
                <span className="min-w-0 truncate text-sm text-foreground/80">{d.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-primary-soft-foreground hover:bg-primary/10 hover:text-primary-soft-foreground"
                    onClick={() => navigate(`/copilot/${d.id}/editar?builder=1`)}
                  >
                    Retomar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Excluir rascunho ${d.name}`}
                    className="h-8 w-8 rounded-xl p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setAgentToDelete(d.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Subscription Warning - Apenas para quem não tem acesso */}
      {!canManageCopilot && (isTrial || !hasAccess) && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="border-primary/30">
            <CardContent className="flex items-start gap-4 p-5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                <Lock className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="mb-1 text-base font-bold tracking-tight">
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
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Agents List */}
      {agents && agents.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent, index) => {
            const pipes = (agent.active_pipes as string[]) || [];
            return (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.05 }}
              >
                <Card
                  className="group flex h-full cursor-pointer flex-col transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-relevo-alto motion-reduce:transition-none"
                  onClick={() => handleOpenConfig(agent)}
                >
                  <div className="flex items-start gap-3 p-5 pb-4">
                    <span
                      className={cn(
                        "grid h-11 w-11 shrink-0 place-items-center rounded-2xl",
                        agent.is_active ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-foreground/60",
                      )}
                    >
                      <Bot className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <CardTitle className="truncate">{agent.name}</CardTitle>
                        {agent.is_default && (
                          <Star
                            className="h-3.5 w-3.5 shrink-0 fill-primary text-primary"
                            aria-label="Agente padrão"
                          />
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs capitalize text-muted-foreground">
                        {agent.template_type}
                      </p>
                    </div>
                    {agent.is_active ? (
                      <Badge variant="success" className="shrink-0 gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                        Ativo
                      </Badge>
                    ) : (
                      <Badge variant="soft" className="shrink-0">Inativo</Badge>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-4 px-5 pb-5">
                    <div>
                      <span className={MICRO_LABEL}>Personalidade</span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Badge variant="soft" className="text-[11px]">{agent.personality_tone}</Badge>
                        <Badge variant="soft" className="text-[11px]">{agent.personality_style}</Badge>
                        <Badge variant="soft" className="text-[11px]">{agent.personality_energy}</Badge>
                      </div>
                    </div>

                    <div>
                      <span className={MICRO_LABEL}>Habilidades</span>
                      <p className="mt-1 text-sm">
                        <span className="font-extrabold tabular-nums tracking-[-0.02em]">
                          {agent.skills?.length || 0}
                        </span>{" "}
                        <span className="text-muted-foreground">configuradas</span>
                      </p>
                    </div>

                    {/* Pipeline Info */}
                    <div>
                      <span className={cn(MICRO_LABEL, "flex items-center gap-1")}>
                        <GitBranch className="h-3 w-3" />
                        Funis ativos
                      </span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {pipes.length > 0 ? (
                          pipes.map((pipe) => (
                            <Badge key={pipe} variant="info" className="text-[11px] capitalize">
                              {labelForRef(pipe)}
                            </Badge>
                          ))
                        ) : (
                          <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning-strong">
                            <AlertTriangle className="h-3 w-3" />
                            Nenhum funil — configure antes de ativar
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {canManageCopilot && (
                    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 px-5 py-3.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenConfig(agent);
                        }}
                      >
                        <Settings />
                        Configurar
                      </Button>

                      {builderEnabled && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/copilot/${agent.id}/editar?builder=1`);
                          }}
                        >
                          <Sparkles className="text-primary" />
                          Revisar com IA
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => handleToggleAgent(agent, e)}
                        disabled={toggleAgent.isPending}
                      >
                        <Power />
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
                          <Star />
                          Padrão
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Excluir ${agent.name}`}
                        className="ml-auto h-9 w-9 rounded-xl p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAgentToDelete(agent.id);
                        }}
                        disabled={deleteAgent.isPending}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <Card>
            <CardContent className="flex flex-col items-center px-6 py-16 text-center">
              <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
                <Bot className="h-7 w-7" />
              </span>
              <h3 className="mb-1.5 text-lg font-extrabold tracking-[-0.02em]">
                Nenhum Copilot configurado
              </h3>
              <p className="mb-6 max-w-sm text-sm text-muted-foreground">
                Crie seu primeiro agente de IA para começar a automatizar suas
                vendas
              </p>
              {canManageCopilot && (
                <Button onClick={handleCreateAgent}>
                  <Plus />
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
              <AlertTriangle className="w-5 h-5 text-warning-strong" />
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

    </div>
  );
}
