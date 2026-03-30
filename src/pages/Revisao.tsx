import { useState, useMemo } from "react";
import { Search, Lightbulb, ChevronDown, ChevronUp, Settings2, ClipboardList, MessageSquare, ListChecks } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { EmptyState } from "@/components/shared/EmptyState";
import { RevisionItem, type RevisionTask } from "@/components/revisao/RevisionItem";
import { AutomationSettings } from "@/components/followups/AutomationSettings";
import { useFollowUps, useCompleteFollowUp, useArchiveFollowUp, useDeleteFollowUp } from "@/hooks/useFollowUps";
import { useMyScheduledMessages, useCancelScheduledMessage } from "@/hooks/useScheduledMessages";
import { useDailyPriorities } from "@/hooks/useDailyPriorities";
import { useTeamMembers, useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useUserRole, useFeaturePermission } from "@/hooks/useUserRole";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function Revisao() {
  const [searchQuery, setSearchQuery] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>("mine");
  const [showCompleted, setShowCompleted] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [automationSettingsOpen, setAutomationSettingsOpen] = useState(false);

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
    assignedTo: assignedTo === "all" ? "all" : currentMember?.id,
  });

  const { data: priorities, totalPending: suggestionsCount } = useDailyPriorities();

  const completeFollowUp = useCompleteFollowUp();
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
      isAutomated: fu.is_automated,
    }));

    const smTasks: RevisionTask[] = scheduledMessages.map((sm: any) => ({
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

  const handleComplete = (id: string, type: string) => {
    if (type === "follow-up") {
      completeFollowUp.mutate(id);
    } else {
      cancelMessage.mutate(id);
    }
  };

  const isLoading = fuLoading || smLoading;

  const renderList = (tasks: RevisionTask[]) => {
    const pending = tasks.filter((t) => !t.isCompleted);
    const completed = tasks.filter((t) => t.isCompleted);

    if (pending.length === 0 && completed.length === 0) return null;

    return (
      <div>
        {pending.map((task) => (
          <RevisionItem
            key={`${task.type}-${task.id}`}
            task={task}
            onComplete={(id) => handleComplete(id, task.type)}
            onCancel={task.type === "scheduled-message" ? (id) => cancelMessage.mutate(id) : undefined}
            onArchive={task.type === "follow-up" ? (id) => archiveFollowUp.mutate(id) : undefined}
            onDelete={task.type === "follow-up" ? (id) => deleteFollowUp.mutate(id) : undefined}
            canDelete={canDelete}
          />
        ))}

        {showCompleted && completed.length > 0 && (
          <>
            <div className="flex items-center gap-3 py-3 px-2">
              <div className="flex-1 h-px bg-border/50" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground/40 font-medium">
                Concluídos ({completed.length})
              </span>
              <div className="flex-1 h-px bg-border/50" />
            </div>
            {completed.map((task) => (
              <RevisionItem
                key={`${task.type}-${task.id}`}
                task={task}
                onComplete={() => {}}
                canDelete={canDelete}
              />
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Revisão</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Suas tarefas e mensagens agendadas
          </p>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setAutomationSettingsOpen(true)} className="gap-1.5">
            <Settings2 className="w-4 h-4" />
            Automações
          </Button>
        )}
      </div>

      <Tabs defaultValue="all" className="w-full">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="all">Tudo</TabsTrigger>
            <TabsTrigger value="messages">Mensagens</TabsTrigger>
            <TabsTrigger value="followups">Follow-ups</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 w-48"
              />
            </div>

            {isAdmin && (
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger className="h-9 w-40">
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

            <div className="flex items-center gap-1.5">
              <Checkbox
                id="show-completed"
                checked={showCompleted}
                onCheckedChange={(v) => setShowCompleted(!!v)}
              />
              <Label htmlFor="show-completed" className="text-xs text-muted-foreground cursor-pointer">
                Concluídos
              </Label>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3 mt-6">
            {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : (
          <>
            <TabsContent value="all" className="mt-4">
              {suggestionsCount > 0 && (
                <div className="mb-4">
                  <button
                    onClick={() => setSuggestionsOpen(!suggestionsOpen)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm transition-colors hover:bg-primary/10"
                  >
                    <span className="flex items-center gap-2 text-foreground/80">
                      <Lightbulb className="w-3.5 h-3.5 text-primary" />
                      Sugestões ({suggestionsCount})
                    </span>
                    {suggestionsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {suggestionsOpen && priorities && (
                    <div className="mt-1 space-y-1">
                      {priorities.leads_sem_acao?.slice(0, 3).map((lead) => (
                        <div key={lead.id} className="flex items-center px-3 py-1.5 rounded-md bg-card border border-border text-xs">
                          <span className="text-muted-foreground">
                            Lead sem contato: <span className="text-foreground font-medium">{lead.name}</span>
                            {lead.company && ` · ${lead.company}`}
                          </span>
                        </div>
                      ))}
                      {priorities.followups_vencidos?.slice(0, 3).map((fu) => (
                        <div key={fu.id} className="flex items-center px-3 py-1.5 rounded-md bg-card border border-border text-xs">
                          <span className="text-muted-foreground">
                            Follow-up vencido: <span className="text-foreground font-medium">{fu.lead?.name || fu.title}</span>
                            {` · ${fu.days_overdue}d atrás`}
                          </span>
                        </div>
                      ))}
                      {priorities.leads_quentes?.slice(0, 3).map((lead) => (
                        <div key={lead.id} className="flex items-center px-3 py-1.5 rounded-md bg-card border border-border text-xs">
                          <span className="text-muted-foreground">
                            Lead quente: <span className="text-foreground font-medium">{lead.name}</span>
                            {lead.company && ` · ${lead.company}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {filteredTasks.length === 0 ? (
                <EmptyState icon={ClipboardList} title="Nenhuma tarefa pendente" description="Sua pista está limpa." />
              ) : (
                renderList(filteredTasks)
              )}
            </TabsContent>

            <TabsContent value="messages" className="mt-4">
              {messageTasks.length === 0 ? (
                <EmptyState icon={MessageSquare} title="Nenhuma mensagem agendada" description="Agende mensagens pelo chat ou pelo modal do lead." />
              ) : (
                renderList(messageTasks)
              )}
            </TabsContent>

            <TabsContent value="followups" className="mt-4">
              {followUpTasks.length === 0 ? (
                <EmptyState icon={ListChecks} title="Nenhum follow-up pendente" description="Crie follow-ups nos funis ou no drawer do lead." />
              ) : (
                renderList(followUpTasks)
              )}
            </TabsContent>
          </>
        )}
      </Tabs>

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
    </div>
  );
}
