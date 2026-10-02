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

/** Cartão de bento que segura uma lista da Revisão (itens ou estado vazio). */
function ListaCard({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-card border border-card-border bg-card p-2 text-card-foreground shadow-relevo">
      {children}
    </section>
  );
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

  const renderList = (tasks: RevisionTask[]) => {
    const pending = tasks.filter((t) => !t.isCompleted);
    const completed = tasks.filter((t) => t.isCompleted);

    if (pending.length === 0 && completed.length === 0) return null;

    return (
      <ListaCard>
        {pending.map((task) => (
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
        ))}

        {showCompleted && completed.length > 0 && (
          <>
            <div className="flex items-center gap-3 px-3 py-3">
              <div className="h-px flex-1 bg-border/60" />
              <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                Concluídos <span className="tabular-nums">({completed.length})</span>
              </span>
              <div className="h-px flex-1 bg-border/60" />
            </div>
            {completed.map((task) => (
              <RevisionItem
                key={`${task.type}-${task.id}`}
                task={task}
                timezone={timezone}
                onComplete={() => {}}
                canDelete={canDelete}
              />
            ))}
          </>
        )}
      </ListaCard>
    );
  };

  return (
    // A página inteira mora no <Tabs>: a lista de abas sobe para o cabeçalho
    // (navegação da página, pílula escura) e os conteúdos ficam aqui embaixo —
    // o Radix só exige que List e Content estejam sob a mesma raiz.
    <Tabs defaultValue="all" className="space-y-5">
      <PageHeader
        title="Revisão"
        subtitle="Suas tarefas e mensagens agendadas"
        actions={
          isAdmin && (
            <Button variant="outline" onClick={() => setAutomationSettingsOpen(true)}>
              <Settings2 />
              Automações
            </Button>
          )
        }
        tabs={
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
            <TabsList variant="pill" aria-label="Tipo de tarefa" className="self-start">
              <TabsTrigger value="all">Tudo</TabsTrigger>
              <TabsTrigger value="messages">Mensagens</TabsTrigger>
              <TabsTrigger value="followups">Follow-ups</TabsTrigger>
            </TabsList>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 sm:w-56"
                />
              </div>

              {isAdmin && (
                <Select value={assignedTo} onValueChange={setAssignedTo}>
                  <SelectTrigger className="w-full sm:w-44" aria-label="Responsável">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mine">Minhas tarefas</SelectItem>
                    <SelectItem value="all">Todas</SelectItem>
                    {teamMembers.filter((m) => m.is_active).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <div className="flex h-10 items-center gap-2 rounded-full border border-input bg-card px-3.5 shadow-relevo">
                <Checkbox
                  id="show-completed"
                  checked={showCompleted}
                  onCheckedChange={(v) => setShowCompleted(!!v)}
                />
                <Label htmlFor="show-completed" className="cursor-pointer text-[13px] font-medium text-foreground/80">
                  Concluídos
                </Label>
              </div>
            </div>
          </div>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
        </div>
      ) : (
        <>
          <TabsContent value="all" className="mt-0 space-y-4">
            {suggestionsCount > 0 && (
              <section className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
                <button
                  type="button"
                  onClick={() => setSuggestionsOpen(!suggestionsOpen)}
                  aria-expanded={suggestionsOpen}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary-soft-foreground">
                    <Lightbulb className="h-4 w-4" strokeWidth={2.2} />
                  </span>
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

            {filteredTasks.length === 0 ? (
              <ListaCard>
                <EmptyState icon={ClipboardList} title="Nenhuma tarefa pendente" description="Sua pista está limpa." />
              </ListaCard>
            ) : (
              renderList(filteredTasks)
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

export default function Revisao() {
  return <RevisaoInner />;
}
