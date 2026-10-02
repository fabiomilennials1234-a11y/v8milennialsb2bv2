import { useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
import type { ReactNode } from "react";
import {
  Search,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Settings2,
  ClipboardList,
  MessageSquare,
  ListChecks,
  Clock,
  AlarmClock,
  AlarmClockOff,
  Sun,
  Sunrise,
  CalendarRange,
  CheckCheck,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/shared/components/EmptyState";
import { RevisionItem, type RevisionTask } from "@/modules/engagement/components/revisao/RevisionItem";
import { AutomationSettings } from "@/modules/engagement/components/followups/AutomationSettings";
import { ScheduleFollowUpModal } from "@/modules/engagement/components/followups/ScheduleFollowUpModal";
import { useFollowUps, useCompleteFollowUp, useUpdateFollowUp, useArchiveFollowUp, useDeleteFollowUp } from "@/modules/engagement/hooks/useFollowUps";
import { useMyScheduledMessages, useCancelScheduledMessage } from "@/modules/communication/hooks/useScheduledMessages";
import { useDailyPriorities } from "@/modules/engagement/hooks/useDailyPriorities";
import { useTeamMembers, useCurrentTeamMember, useOrganization } from "@/modules/identity";
import { useUserRole, useFeaturePermission } from "@/modules/identity";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconChip, KpiRow, KpiTile } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import { AtrasadasHero, type AcoesDaRevisao } from "@/modules/engagement/components/revisao/AtrasadasHero";
import { cortesDosPrazos, prazoDe, type Prazo } from "@/modules/engagement/lib/prazo-da-revisao";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";

/** Cartão de bento que segura uma lista da Revisão (itens ou estado vazio). */
function ListaCard({ children, titulo, contagem, data }: { children: ReactNode; titulo?: string; contagem?: number; data?: string }) {
  return (
    <section className="rounded-card border border-card-border bg-card p-2 text-card-foreground shadow-relevo">
      {titulo && (
        <header className="px-3 pb-1 pt-2.5">
          <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.02em]">
            {titulo}
            {contagem != null && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-tinta px-1.5 text-[11px] font-bold tabular-nums text-tinta-foreground">
                {contagem}
              </span>
            )}
          </h2>
          {data && <p className="text-[12px] text-muted-foreground">{data}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

const PRAZOS: { value: "todos" | Prazo; label: string; icon?: typeof Sun }[] = [
  { value: "todos", label: "Todos os prazos" },
  { value: "atrasadas", label: "Atrasadas", icon: AlarmClockOff },
  { value: "hoje", label: "Hoje", icon: Sun },
  { value: "amanha", label: "Amanhã", icon: Sunrise },
  { value: "semana", label: "Esta semana", icon: CalendarRange },
];

const GRUPOS: { prazo: Exclude<Prazo, "atrasadas">; titulo: string }[] = [
  { prazo: "hoje", titulo: "Hoje" },
  { prazo: "amanha", titulo: "Amanhã" },
  { prazo: "semana", titulo: "Esta semana" },
  { prazo: "depois", titulo: "Depois" },
];

/** "quinta, 1º de outubro" no fuso da organização. */
function diaPorExtenso(d: Date, timeZone: string) {
  const txt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone }).format(d);
  return txt.replace("-feira", "").replace(/^(\S+), 1 de/, "$1, 1º de");
}

function RevisaoInner() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>("mine");
  const [showCompleted, setShowCompleted] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [automationSettingsOpen, setAutomationSettingsOpen] = useState(false);

  const { timezone } = useOrganization();
  const { data: userRole } = useUserRole();
  const isAdmin = userRole?.role === "admin";
  const { data: currentMember } = useCurrentTeamMember();
  const { data: teamMembers = [] } = useTeamMembers();
  const { allowed: canDelete } = useFeaturePermission("followups.delete");

  const effectiveAssignedTo = assignedTo === "mine" ? currentMember?.id : assignedTo === "all" ? undefined : assignedTo;

  const { data: followUps = [], isLoading: fuLoading } = useFollowUps({
    assignedTo: effectiveAssignedTo,
    showCompleted,
    showArchived: false,
    dateFilter: "all",
  });

  const { data: scheduledMessages = [], isLoading: smLoading } = useMyScheduledMessages({
    showCompleted,
    assignedTo: assignedTo === "all" ? "all" : effectiveAssignedTo,
  });

  const { data: priorities, totalPending: suggestionsCount } = useDailyPriorities();

  const [scheduleContext, setScheduleContext] = useState<{
    leadId: string;
    leadName: string;
    sourcePipe?: "whatsapp" | "confirmacao" | "propostas";
    sourcePipeId?: string;
    defaultAssignedTo?: string;
  } | null>(null);

  const completeFollowUp = useCompleteFollowUp();
  const updateFollowUp = useUpdateFollowUp();
  const archiveFollowUp = useArchiveFollowUp();
  const deleteFollowUp = useDeleteFollowUp();
  const cancelMessage = useCancelScheduledMessage();

  const allTasks: RevisionTask[] = useMemo(() => {
    const fuTasks: RevisionTask[] = followUps.map((fu) => ({
      id: fu.id,
      type: "follow-up" as const,
      title: fu.title,
      leadName: fu.lead?.name || "Sem nome",
      leadCompany: fu.lead?.company || undefined,
      leadPhone: fu.lead?.phone || undefined,
      leadId: fu.lead_id,
      scheduledAt: new Date(fu.due_date),
      priority: fu.priority as RevisionTask["priority"],
      isCompleted: !!fu.completed_at,
      completedAt: fu.completed_at ? new Date(fu.completed_at) : undefined,
      description: fu.description || undefined,
      assignedTo: fu.assigned_to || undefined,
      assignedToName: fu.team_member?.name,
      sourcePipe: fu.source_pipe || undefined,
      sourcePipeId: fu.source_pipe_id || undefined,
      isAutomated: fu.is_automated,
    }));

    const smTasks: RevisionTask[] = scheduledMessages.map((sm) => ({
      id: sm.id,
      type: "scheduled-message" as const,
      title: sm.message_content?.slice(0, 60) || `[${sm.media_type || "mídia"}]`,
      leadName: sm.lead?.name || "Sem nome",
      leadCompany: sm.lead?.company || undefined,
      leadPhone: sm.lead?.phone || sm.phone_number,
      leadId: sm.lead_id,
      scheduledAt: new Date(sm.scheduled_at),
      isCompleted: sm.status === "sent" || sm.status === "cancelled",
      completedAt: sm.sent_at ? new Date(sm.sent_at) : undefined,
      messageContent: sm.message_content || undefined,
      mediaUrl: sm.media_url || undefined,
      mediaType: sm.media_type || undefined,
      status: sm.status,
    }));

    return [...fuTasks, ...smTasks].sort(
      (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()
    );
  }, [followUps, scheduledMessages]);

  const filteredTasks = useMemo(() => {
    if (!searchQuery) return allTasks;
    const q = searchQuery.toLowerCase();
    return allTasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.leadName.toLowerCase().includes(q) ||
        t.leadCompany?.toLowerCase().includes(q)
    );
  }, [allTasks, searchQuery]);

  const messageTasks = filteredTasks.filter((t) => t.type === "scheduled-message");
  const followUpTasks = filteredTasks.filter((t) => t.type === "follow-up");

  const handleComplete = (id: string, type: string, notes?: string) => {
    if (type === "follow-up") {
      completeFollowUp.mutate({ id, completion_notes: notes });
    } else {
      cancelMessage.mutate(id);
    }
  };

  const handleReschedule = (id: string, newDate: string) => {
    updateFollowUp.mutate({ id, due_date: newDate });
  };

  const handleOpenLead = (leadId: string) => {
    navigate(`/leads?lead=${leadId}`);
  };

  const handleScheduleNew = (
    leadId: string,
    leadName: string,
    sourcePipe?: string,
    sourcePipeId?: string,
    assignedTo?: string,
  ) => {
    setScheduleContext({
      leadId,
      leadName,
      sourcePipe: sourcePipe as "whatsapp" | "confirmacao" | "propostas" | undefined,
      sourcePipeId,
      defaultAssignedTo: assignedTo,
    });
  };

  const isLoading = fuLoading || smLoading;

  // ── Prazos (corte por dia no fuso da org — a mesma régua do selo vermelho) ──
  const [prazo, setPrazo] = useState<"todos" | Prazo>("todos");
  const [aba, setAba] = useState("all");
  const cortes = useMemo(() => cortesDosPrazos(timezone), [timezone]);
  const prazoDoItem = (t: RevisionTask) => prazoDe(t.scheduledAt, cortes);

  const pendentes = filteredTasks.filter((t) => !t.isCompleted);
  const contagemAba = {
    all: pendentes.length,
    messages: pendentes.filter((t) => t.type === "scheduled-message").length,
    followups: pendentes.filter((t) => t.type === "follow-up").length,
  };

  // KPIs: sempre sobre a pilha inteira da pessoa/escopo, não sobre a busca.
  const pendentesTodas = allTasks.filter((t) => !t.isCompleted);
  const atrasadasTodas = pendentesTodas.filter((t) => prazoDoItem(t) === "atrasadas");
  const hojeTodas = pendentesTodas.filter((t) => prazoDoItem(t) === "hoje");
  const mensagensPendentes = pendentesTodas.filter((t) => t.type === "scheduled-message");
  const maisAntiga = atrasadasTodas[0];
  const proximaMensagem = mensagensPendentes.find((t) => t.scheduledAt.getTime() >= Date.now()) ?? mensagensPendentes[0];

  const acoes: AcoesDaRevisao = {
    onComplete: (t, notes) => handleComplete(t.id, t.type, notes),
    onCancel: (t) => cancelMessage.mutate(t.id),
    onArchive: (t) => archiveFollowUp.mutate(t.id),
    onDelete: (t) => deleteFollowUp.mutate(t.id),
    onReschedule: (t, iso) => handleReschedule(t.id, iso),
    onOpenLead: handleOpenLead,
    onScheduleNew: (t) => handleScheduleNew(t.leadId, t.leadName, t.sourcePipe, t.sourcePipeId, t.assignedTo),
    canDelete,
  };

  const renderItem = (task: RevisionTask) =>
    task.isCompleted ? (
      <RevisionItem
        key={`${task.type}-${task.id}`}
        task={task}
        timezone={timezone}
        onComplete={() => {}}
        canDelete={canDelete}
      />
    ) : (
      <RevisionItem
        key={`${task.type}-${task.id}`}
        task={task}
        timezone={timezone}
        onComplete={(id, notes) => handleComplete(id, task.type, notes)}
        onCancel={task.type === "scheduled-message" ? (id) => cancelMessage.mutate(id) : undefined}
        onArchive={task.type === "follow-up" ? (id) => archiveFollowUp.mutate(id) : undefined}
        onDelete={task.type === "follow-up" ? (id) => deleteFollowUp.mutate(id) : undefined}
        onReschedule={task.type === "follow-up" ? handleReschedule : undefined}
        onOpenLead={handleOpenLead}
        onScheduleNew={task.type === "follow-up" ? handleScheduleNew : undefined}
        canDelete={canDelete}
      />
    );

  /**
   * V5: o que venceu vai para o herói em tinta; o resto, em cartões por prazo
   * (Hoje · Amanhã · Esta semana · Depois). Os itens são os mesmos de antes,
   * com as mesmas ações — só a ordem de leitura mudou.
   */
  const renderList = (tasks: RevisionTask[]) => {
    const pending = tasks.filter((t) => !t.isCompleted);
    const completed = tasks.filter((t) => t.isCompleted);
    const noPrazo = prazo === "todos" ? pending : pending.filter((t) => prazoDoItem(t) === prazo);
    const atrasadas = noPrazo.filter((t) => prazoDoItem(t) === "atrasadas");
    const grupos = GRUPOS.map((g) => ({ ...g, itens: noPrazo.filter((t) => prazoDoItem(t) === g.prazo) })).filter(
      (g) => g.itens.length > 0,
    );
    const mostrarConcluidas = showCompleted && completed.length > 0 && prazo === "todos";

    if (noPrazo.length === 0 && !mostrarConcluidas) {
      return (
        <ListaCard>
          <EmptyState icon={CheckCheck} title="Nada neste prazo" description="Troque o filtro de prazo para ver o resto da pista." />
        </ListaCard>
      );
    }

    const dataDoGrupo = (p: Exclude<Prazo, "atrasadas">) =>
      p === "hoje"
        ? diaPorExtenso(cortes.hoje, cortes.timeZone)
        : p === "amanha"
          ? diaPorExtenso(cortes.amanha, cortes.timeZone)
          : p === "semana"
            ? `até ${diaPorExtenso(new Date(cortes.proximaSegunda.getTime() - 12 * 3_600_000), cortes.timeZone)}`
            : "da próxima semana em diante";

    return (
      <div className="space-y-4">
        {atrasadas.length > 0 && <AtrasadasHero tasks={atrasadas} acoes={acoes} />}
        {grupos.map((g) => (
          <ListaCard key={g.prazo} titulo={g.titulo} contagem={g.itens.length} data={dataDoGrupo(g.prazo)}>
            {g.itens.map(renderItem)}
          </ListaCard>
        ))}
        {mostrarConcluidas && (
          <ListaCard titulo="Concluídos" contagem={completed.length}>
            {completed.map(renderItem)}
          </ListaCard>
        )}
      </div>
    );
  };

  const contagemPrazo = (p: "todos" | Prazo) =>
    p === "todos" ? pendentes.length : pendentes.filter((t) => prazoDoItem(t) === p).length;

  return (
    // A página inteira mora no <Tabs>: a lista de abas sobe para o cabeçalho
    // (navegação da página, pílula escura) e os conteúdos ficam aqui embaixo —
    // o Radix só exige que List e Content estejam sob a mesma raiz.
    <Tabs value={aba} onValueChange={setAba} className="space-y-5">
      <PageHeader
        title="Revisão"
        subtitle="Suas tarefas e mensagens agendadas"
        actions={
          isAdmin && (
            <>
              {/* "Minhas | Todas" convive com o seletor de pessoa: em "Todas" o
                  seletor escolhe a equipe inteira ou uma pessoa. */}
              <Tabs value={assignedTo === "mine" ? "mine" : "all"} onValueChange={(v) => setAssignedTo(v)}>
                <TabsList variant="segmented" aria-label="Escopo das tarefas">
                  <TabsTrigger value="mine">Minhas tarefas</TabsTrigger>
                  <TabsTrigger value="all">Todas</TabsTrigger>
                </TabsList>
              </Tabs>
              {assignedTo !== "mine" && (
                <Select value={assignedTo} onValueChange={setAssignedTo}>
                  <SelectTrigger className="w-44" aria-label="Responsável">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mine">Minhas tarefas</SelectItem>
                    <SelectItem value="all">Toda a equipe</SelectItem>
                    {teamMembers.filter((m) => m.is_active).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" onClick={() => setAutomationSettingsOpen(true)}>
                <Settings2 />
                Automações
              </Button>
            </>
          )
        }
        tabs={
          <TabsList variant="pill" aria-label="Tipo de tarefa" className="self-start">
            <TabsTrigger value="all">Tudo <Contagem n={contagemAba.all} /></TabsTrigger>
            <TabsTrigger value="messages">Mensagens <Contagem n={contagemAba.messages} /></TabsTrigger>
            <TabsTrigger value="followups">Follow-ups <Contagem n={contagemAba.followups} /></TabsTrigger>
          </TabsList>
        }
      />

      {!isLoading && (
        <KpiRow cols={4}>
          <KpiTile
            className="h-full"
            label="Atrasadas"
            icon={AlarmClockOff}
            tone="bad"
            value={atrasadasTodas.length}
            note={
              maisAntiga
                ? `a mais antiga venceu há ${formatDistanceToNowStrict(maisAntiga.scheduledAt, { locale: ptBR })}`
                : "nada vencido"
            }
          />
          <KpiTile
            className="h-full"
            label="Para hoje"
            icon={Sun}
            tone="gold"
            value={hojeTodas.length}
            note={`${hojeTodas.filter((t) => t.type === "follow-up").length} tarefas · ${hojeTodas.filter((t) => t.type === "scheduled-message").length} mensagens`}
          />
          <KpiTile
            className="h-full"
            label="Mensagens agendadas"
            icon={MessageSquare}
            tone="info"
            value={mensagensPendentes.length}
            note={proximaMensagem ? `próxima: ${proximaMensagem.scheduledAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "nenhuma na fila"}
          >
            {mensagensPendentes.length > 0 && (
              <Button variant="ink" size="sm" className="h-8" onClick={() => setAba("messages")}>
                Ver mensagens
              </Button>
            )}
          </KpiTile>
          <KpiTile
            className="h-full"
            label="Sugestões do dia"
            icon={Lightbulb}
            tone="neutral"
            value={suggestionsCount}
            note="lead sem contato e follow-up vencido"
          />
        </KpiRow>
      )}

      {/* Filtro de prazo + concluídos + busca. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div role="group" aria-label="Prazo" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide lg:mx-0 lg:px-0 lg:pb-0">
          {PRAZOS.map((p) => {
            const ativo = prazo === p.value;
            const Icone = p.icon;
            const n = contagemPrazo(p.value);
            return (
              <button
                key={p.value}
                type="button"
                aria-pressed={ativo}
                onClick={() => setPrazo(p.value)}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                  ativo
                    ? "bg-tinta text-tinta-foreground shadow-relevo-tinta dark:bg-foreground dark:text-background"
                    : "border border-input bg-card text-foreground/80 shadow-relevo hover:text-foreground",
                )}
              >
                {Icone && <Icone className="h-3.5 w-3.5" aria-hidden />}
                {p.label}
                <span
                  className={cn(
                    "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                    ativo
                      ? "bg-primary text-primary-foreground"
                      : p.value === "atrasadas" && n > 0
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 lg:ml-auto">
          <div className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-input bg-card px-3.5 shadow-relevo">
            <Checkbox
              id="show-completed"
              checked={showCompleted}
              onCheckedChange={(v) => setShowCompleted(!!v)}
            />
            <Label htmlFor="show-completed" className="cursor-pointer text-[13px] font-medium text-foreground/80">
              Concluídos
            </Label>
          </div>
          <div className="relative min-w-0 flex-1 lg:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar tarefa ou lead"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-full pl-9 lg:w-60"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
        </div>
      ) : (
        <>
          <TabsContent value="all" className="mt-0 space-y-4">
            {filteredTasks.length === 0 ? (
              <ListaCard>
                <EmptyState icon={ClipboardList} title="Nenhuma tarefa pendente" description="Sua pista está limpa." />
              </ListaCard>
            ) : (
              renderList(filteredTasks)
            )}

            {suggestionsCount > 0 && (
              <section className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
                <button
                  type="button"
                  onClick={() => setSuggestionsOpen(!suggestionsOpen)}
                  aria-expanded={suggestionsOpen}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <IconChip icon={Lightbulb} tone="gold" />
                  <span className="text-[15px] font-bold tracking-[-0.02em]">Sugestões</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                    {suggestionsCount}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {suggestionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                </button>

                {/* Só dois tipos de sugestão aparecem: lead sem contato e
                    follow-up vencido. "Lead quente" saiu (score do lead não é
                    mais usado — CTO, 02/10); a edge ainda manda a lista, e a
                    tela a ignora. Ver `contarSugestoesDoDia`. */}
                {suggestionsOpen && priorities && (
                  <ul className="divide-y divide-border/50 border-t border-border/50">
                    {priorities.leads_sem_acao?.slice(0, 3).map((lead) => (
                      <li key={lead.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning-strong">
                          <Clock className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 truncate text-muted-foreground">
                          Lead sem contato: <span className="font-semibold text-foreground">{lead.name}</span>
                          {lead.company && ` · ${lead.company}`}
                        </span>
                      </li>
                    ))}
                    {priorities.followups_vencidos?.slice(0, 3).map((fu) => (
                      <li key={fu.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
                          <AlarmClock className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 truncate text-muted-foreground">
                          Follow-up vencido: <span className="font-semibold text-foreground">{fu.lead?.name || fu.title}</span>
                          <span className="tabular-nums">{` · ${fu.days_overdue}d atrás`}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </TabsContent>

          <TabsContent value="messages" className="mt-0">
            {messageTasks.length === 0 ? (
              <ListaCard>
                <EmptyState icon={MessageSquare} title="Nenhuma mensagem agendada" description="Agende mensagens pelo chat ou pelo modal do lead." />
              </ListaCard>
            ) : (
              renderList(messageTasks)
            )}
          </TabsContent>

          <TabsContent value="followups" className="mt-0">
            {followUpTasks.length === 0 ? (
              <ListaCard>
                <EmptyState icon={ListChecks} title="Nenhum follow-up pendente" description="Crie follow-ups nos funis ou no drawer do lead." />
              </ListaCard>
            ) : (
              renderList(followUpTasks)
            )}
          </TabsContent>
        </>
      )}

      {isAdmin && (
        <Dialog open={automationSettingsOpen} onOpenChange={setAutomationSettingsOpen}>
          <DialogContent className="max-w-4xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>Automações de Follow-up</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto">
              <AutomationSettings />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {scheduleContext && (
        <ScheduleFollowUpModal
          open={!!scheduleContext}
          onOpenChange={(open) => { if (!open) setScheduleContext(null); }}
          leadId={scheduleContext.leadId}
          leadName={scheduleContext.leadName}
          sourcePipe={scheduleContext.sourcePipe}
          sourcePipeId={scheduleContext.sourcePipeId}
          defaultAssignedTo={scheduleContext.defaultAssignedTo}
        />
      )}
    </Tabs>
  );
}

/** Contagem dentro do gatilho da pílula ("Tudo 9"). */
function Contagem({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-white/10 px-1.5 text-[11px] font-bold tabular-nums [[data-state=active]>&]:bg-primary-foreground/15">
      {n}
    </span>
  );
}

export default function Revisao() {
  return <RevisaoInner />;
}
