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
  Trash2,
  Star,
  Lock,
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { IconChip, InkRow, InkSplit, KpiRow, KpiTile, ValueUnit } from "@/components/ui/bento";
import { useWhatsAppInstances } from "@/modules/communication";
import { useAgentMetrics } from "@/modules/copilot/hooks/useAgentMetrics";
import { AgentFocusCard } from "@/modules/copilot/components/AgentFocusCard";
import { CopilotTabs } from "@/modules/copilot/components/CopilotTabs";
import { AGENT_TYPE_ORDER, agentTypeLabel } from "@/modules/copilot/lib/agent-labels";
import { FilterChip } from "@/shared/components/FilterChip";
import { FilterRow } from "@/shared/components/PillSearch";

const initialOf = (name: string) => (name.trim().charAt(0) || "?").toUpperCase();

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
  const { data: instances = [] } = useWhatsAppInstances();

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<"all" | "active" | "inactive">("all");
  const [focusId, setFocusId] = useState<string | null>(null);

  const activeAgents = agents?.filter((a) => a.is_active).length ?? 0;
  const typeCounts = AGENT_TYPE_ORDER.map((t) => [t, agents?.filter((a) => a.template_type === t).length ?? 0] as const)
    .filter(([, n]) => n > 0);
  const visibleAgents = (agents ?? []).filter((a) => {
    if (typeFilter !== "all" && a.template_type !== typeFilter) return false;
    if (stateFilter === "active" && !a.is_active) return false;
    if (stateFilter === "inactive" && a.is_active) return false;
    return true;
  });
  const focus = visibleAgents.find((a) => a.id === focusId) ?? visibleAgents[0] ?? null;

  // Reuniões, qualificações e mensagens da IA são números DA ORGANIZAÇÃO no
  // `useAgentMetrics` (a consulta filtra por org, não por agente). Uma chamada
  // basta — a do primeiro agente, chave estável enquanto o foco muda.
  const { data: orgMetrics, isLoading: orgMetricsLoading } = useAgentMetrics(agents?.[0]?.id, "30d");

  const connectionLabel = (instanceId: string | null) => {
    if (!instanceId) return null;
    const i = instances.find((x) => x.id === instanceId);
    return i ? i.instance_name || i.phone_number || "Número conectado" : null;
  };

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

  const handleToggleAgent = (agent: CopilotAgentWithRelations) => {
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
        subtitle="Agentes de IA que atendem, qualificam e marcam reuniões no WhatsApp."
        tabs={<CopilotTabs active="agentes" agentId={focus?.id ?? null} count={agents?.length} />}
        actions={
          <>
            {!copilotQuota.is_unlimited && (
              <Badge variant="soft" className="tabular-nums">
                {copilotQuota.current_usage} de {copilotQuota.effective_limit} agentes
              </Badge>
            )}
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
                Novo copilot
              </Button>
            )}
          </>
        }
      />

      {!canManageCopilot && (
        <p className="-mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Admin ou membros com a permissão habilitada criam copilots e os vinculam a números em Configurações → WhatsApp.
          Se você não vê o botão &quot;Novo copilot&quot;, peça ao administrador para liberar a permissão &quot;Criar agente IA&quot;.
        </p>
      )}

      {builderEnabled && drafts.length > 0 && (
        <section className="flex flex-col gap-3 rounded-card border border-primary/25 bg-primary-soft/60 p-4 shadow-relevo">
          <div className="flex items-center gap-2.5 text-sm font-bold text-foreground">
            <IconChip icon={Sparkles} tone="gold" />
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

      {/* Agentes — resumo, filtro por tipo e a lista em tinta com o foco em ouro */}
      {agents && agents.length > 0 ? (
        <>
          <KpiRow cols={4}>
            <KpiTile
              label="Agentes ativos"
              icon={Bot}
              tone="gold"
              value={
                <>
                  {activeAgents}
                  <ValueUnit>de {agents.length}</ValueUnit>
                </>
              }
              note={`${agents.length - activeAgents} ${agents.length - activeAgents === 1 ? "inativo" : "inativos"}`}
            >
              <div className="flex -space-x-1.5">
                {agents.slice(0, 6).map((a) => (
                  <span
                    key={a.id}
                    className={cn(
                      "grid h-7 w-7 place-items-center rounded-[9px] border-2 border-card text-[11px] font-extrabold",
                      a.is_active ? "bg-tinta text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {initialOf(a.name)}
                  </span>
                ))}
              </div>
            </KpiTile>
            <KpiTile
              label="Reuniões marcadas pela IA"
              icon={CalendarCheck}
              tone="info"
              loading={orgMetricsLoading}
              value={orgMetricsLoading ? "—" : (orgMetrics?.meetingsScheduled ?? 0).toLocaleString("pt-BR")}
              delta={orgMetrics && orgMetrics.trends.meetings.previous > 0 ? orgMetrics.trends.meetings.percentChange : undefined}
              deltaLabel="vs. 30 dias antes"
              note="30 dias · toda a organização"
            />
            <KpiTile
              label="Qualificações pela IA"
              icon={CheckCircle2}
              tone="good"
              loading={orgMetricsLoading}
              value={orgMetricsLoading ? "—" : (orgMetrics?.leadsQualified ?? 0).toLocaleString("pt-BR")}
              delta={orgMetrics && orgMetrics.trends.qualified.previous > 0 ? orgMetrics.trends.qualified.percentChange : undefined}
              deltaLabel="vs. 30 dias antes"
              note="30 dias · toda a organização"
            />
            <KpiTile
              label="Mensagens enviadas pela IA"
              icon={MessageSquare}
              tone="neutral"
              loading={orgMetricsLoading}
              value={orgMetricsLoading ? "—" : (orgMetrics?.messagesSent ?? 0).toLocaleString("pt-BR")}
              note="30 dias · toda a organização"
            />
          </KpiRow>

          <FilterRow>
            <span className="mr-1 shrink-0 text-[13px] font-bold text-foreground/80">Tipo de agente</span>
            <FilterChip active={typeFilter === "all"} aria-pressed={typeFilter === "all"} count={agents.length} onClick={() => setTypeFilter("all")}>
              Todos
            </FilterChip>
            {typeCounts.map(([type, count]) => (
              <FilterChip
                key={type}
                active={typeFilter === type}
                aria-pressed={typeFilter === type}
                count={count}
                onClick={() => setTypeFilter(type)}
              >
                {agentTypeLabel(type)}
              </FilterChip>
            ))}
          </FilterRow>

          {focus ? (
            <InkSplit
              title="Seus agentes"
              count={`${visibleAgents.filter((a) => a.is_active).length} ${visibleAgents.filter((a) => a.is_active).length === 1 ? "ativo" : "ativos"}`}
              actions={
                <div role="radiogroup" aria-label="Estado do agente" className="inline-flex rounded-full bg-white/[.07] p-[3px]">
                  {(
                    [
                      ["all", "Todos"],
                      ["active", "Ativos"],
                      ["inactive", "Inativos"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={stateFilter === key}
                      onClick={() => setStateFilter(key)}
                      className={cn(
                        "rounded-full px-3 py-1 text-[11.5px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        stateFilter === key ? "bg-tinta-foreground text-tinta" : "text-tinta-muted hover:text-tinta-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
              listClassName="lg:max-h-[620px] lg:overflow-y-auto"
              list={
                <>
                  {visibleAgents.map((agent) => {
                    const selected = agent.id === focus.id;
                    return (
                      <InkRow key={agent.id} selected={selected} onClick={() => setFocusId(agent.id)}>
                        <span className="relative shrink-0">
                          <span
                            className={cn(
                              "grid h-[38px] w-[38px] place-items-center rounded-[12px] text-[15px] font-extrabold",
                              selected ? "bg-primary-foreground text-primary" : "bg-white/[.07] text-primary",
                            )}
                          >
                            {initialOf(agent.name)}
                          </span>
                          {agent.is_active && (
                            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-tinta bg-success" aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-bold">{agent.name}</span>
                            {agent.is_default && <Star className="h-3 w-3 shrink-0 fill-current" aria-label="Agente padrão" />}
                          </span>
                          <span className={cn("mt-0.5 block truncate text-[11px]", selected ? "text-primary-foreground/70" : "text-tinta-muted")}>
                            {agentTypeLabel(agent.template_type)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                            selected
                              ? "bg-primary-foreground text-primary"
                              : agent.is_active
                                ? "bg-success/15 text-success"
                                : "bg-white/10 text-tinta-muted",
                          )}
                        >
                          {agent.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </InkRow>
                    );
                  })}
                  {canManageCopilot && (
                    <button
                      type="button"
                      onClick={handleCreateAgent}
                      disabled={!copilotQuota.can_add}
                      className="mt-1.5 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-3 py-3.5 text-[13px] font-semibold text-tinta-muted transition-colors hover:border-white/25 hover:text-tinta-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      Novo copilot
                    </button>
                  )}
                </>
              }
              detail={
                <AgentFocusCard
                  agent={focus}
                  canManage={canManageCopilot}
                  builderEnabled={builderEnabled}
                  pipeLabels={((focus.active_pipes as string[]) || []).map((p) => labelForRef(p))}
                  connectionLabel={connectionLabel(focus.whatsapp_instance_id)}
                  togglePending={toggleAgent.isPending}
                  setDefaultPending={setDefault.isPending}
                  deletePending={deleteAgent.isPending}
                  onToggle={() => handleToggleAgent(focus)}
                  onSetDefault={() => setDefault.mutate(focus.id)}
                  onConfigure={() => handleOpenConfig(focus)}
                  onReviewWithBuilder={() => navigate(`/copilot/${focus.id}/editar?builder=1`)}
                  onDelete={() => setAgentToDelete(focus.id)}
                />
              }
            />
          ) : (
            <div className="rounded-card border border-dashed border-border bg-card/60 px-6 py-12 text-center">
              <p className="text-sm font-bold text-foreground">Nenhum agente com esses filtros</p>
              <p className="mt-1 text-sm text-muted-foreground">Troque o tipo ou o estado.</p>
            </div>
          )}
        </>
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
                  Criar primeiro copilot
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
