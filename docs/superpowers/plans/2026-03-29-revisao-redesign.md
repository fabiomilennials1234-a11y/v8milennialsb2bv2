# Revisão Redesign — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reformular a página Revisão como um checklist unificado de follow-ups + mensagens agendadas com tabs, itens compactos expansíveis, ações contextuais ao completar, e sugestões inteligentes.

**Architecture:** Nova página `Revisao.tsx` com 4 componentes extraídos (`RevisionItem`, `RevisionItemExpanded`, `CompletionBanner`, `SuggestionsSection`). Reutiliza hooks existentes (`useFollowUps`, `useCancelScheduledMessage`) + novo hook `useMyScheduledMessages`. Merge das duas fontes de dados via `RevisionTask` union type. Reativa navegação.

**Tech Stack:** React, TanStack Query, shadcn/ui (Checkbox, Tabs, AnimatePresence), Framer Motion, date-fns, Supabase.

**Spec:** `docs/superpowers/specs/2026-03-29-revisao-redesign.md`

---

## File Map

### Criar:
| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/pages/Revisao.tsx` | Página principal — tabs, filtros, merge de dados, layout |
| `src/components/revisao/RevisionItem.tsx` | Item compacto + expandido inline + completion banner |

### Modificar:
| Arquivo | Mudança |
|---------|---------|
| `src/hooks/useScheduledMessages.ts` | Adicionar `useMyScheduledMessages()` |
| `src/components/layout/Sidebar.tsx` | Descomentar Revisão |
| `src/components/layout/TopNavigation.tsx` | Descomentar Revisão |
| `src/App.tsx` | Trocar `PipeFollowUps` por `Revisao` na rota |

---

## Task 1: Hook `useMyScheduledMessages`

**Files:**
- Modify: `src/hooks/useScheduledMessages.ts`

- [ ] **Step 1: Adicionar hook**

No final do arquivo `src/hooks/useScheduledMessages.ts`, antes do último `}`, adicionar:

```typescript
/** Todas as mensagens agendadas do membro logado (ou da org para admin) */
export function useMyScheduledMessages(filters?: {
  showCompleted?: boolean;
  assignedTo?: string;
}) {
  const { organizationId } = useOrganization();
  const { data: member } = useCurrentTeamMember();

  return useQuery({
    queryKey: ["scheduled-messages", "my", organizationId, member?.id, filters],
    queryFn: async () => {
      if (!organizationId || !member) return [];

      let query = supabase
        .from("scheduled_user_messages")
        .select("*, lead:leads(name, company, phone)")
        .eq("organization_id", organizationId)
        .order("scheduled_at", { ascending: true });

      if (filters?.assignedTo && filters.assignedTo !== "all") {
        query = query.eq("created_by", filters.assignedTo);
      } else if (!filters?.assignedTo) {
        query = query.eq("created_by", member.id);
      }

      if (filters?.showCompleted) {
        query = query.in("status", ["scheduled", "sent", "cancelled", "failed"]);
      } else {
        query = query.eq("status", "scheduled");
      }

      const { data, error } = await query;
      if (error) return [];
      return data ?? [];
    },
    enabled: !!organizationId && !!member,
    retry: false,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useScheduledMessages.ts
git commit -m "feat(hooks): add useMyScheduledMessages for Revisão page"
```

---

## Task 2: RevisionItem component

**Files:**
- Create: `src/components/revisao/RevisionItem.tsx`

- [ ] **Step 1: Criar diretório e componente**

```bash
mkdir -p src/components/revisao
```

Criar `src/components/revisao/RevisionItem.tsx`:

```typescript
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, isPast, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  MessageSquare,
  Clock,
  ChevronDown,
  ChevronUp,
  Pencil,
  X,
  ExternalLink,
  Calendar,
  Kanban,
  Bot,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
import { useOpenWhatsAppChat, formatPhoneForWhatsApp } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────

export interface RevisionTask {
  id: string;
  type: "follow-up" | "scheduled-message";
  title: string;
  leadName: string;
  leadCompany?: string;
  leadPhone?: string;
  leadId: string;
  scheduledAt: Date;
  priority?: "low" | "normal" | "high" | "urgent";
  isCompleted: boolean;
  completedAt?: Date;
  // Follow-up specific
  description?: string;
  assignedTo?: string;
  assignedToName?: string;
  sourcePipe?: string;
  isAutomated?: boolean;
  // Scheduled message specific
  messageContent?: string;
  mediaUrl?: string;
  mediaType?: string;
  status?: string;
}

// ─── Priority dot ────────────────────────────────────────

function PriorityDot({ priority }: { priority?: string }) {
  if (priority === "urgent") return <span className="w-2 h-2 rounded-full bg-destructive flex-shrink-0" />;
  if (priority === "high") return <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0" />;
  return null;
}

// ─── Pipe icon ───────────────────────────────────────────

const PIPE_ICONS: Record<string, typeof MessageSquare> = {
  whatsapp: MessageSquare,
  confirmacao: Calendar,
  propostas: Kanban,
};

// ─── Date formatter ──────────────────────────────────────

function formatTaskDate(date: Date): string {
  if (isToday(date)) return format(date, "'Hoje' HH:mm");
  return format(date, "dd/MM HH:mm", { locale: ptBR });
}

// ─── Component ───────────────────────────────────────────

interface RevisionItemProps {
  task: RevisionTask;
  onComplete: (id: string) => void;
  onCancel?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
}

export function RevisionItem({
  task,
  onComplete,
  onCancel,
  onArchive,
  onDelete,
  canDelete,
}: RevisionItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [showCompletionBanner, setShowCompletionBanner] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const openWhatsApp = useOpenWhatsAppChat();

  const isOverdue = !task.isCompleted && isPast(task.scheduledAt);
  const hasPhone = !!formatPhoneForWhatsApp(task.leadPhone ?? undefined);

  const handleComplete = () => {
    onComplete(task.id);
    if (task.type === "follow-up") {
      setShowCompletionBanner(true);
      setTimeout(() => setShowCompletionBanner(false), 5000);
    }
  };

  const handleSkipBanner = () => {
    setShowCompletionBanner(false);
  };

  return (
    <>
      <div
        className={cn(
          "group flex items-start gap-3 py-3 px-2 rounded-lg cursor-pointer transition-colors",
          "hover:bg-muted/30",
          task.isCompleted && "opacity-50"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Checkbox */}
        <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={task.isCompleted}
            onCheckedChange={() => handleComplete()}
            className={cn(
              "transition-transform",
              task.isCompleted && "animate-celebrate"
            )}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Row 1: Title + Badge */}
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-sm font-medium truncate flex-1",
              task.isCompleted && "line-through"
            )}>
              {task.title}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 shrink-0",
                task.type === "scheduled-message"
                  ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                  : "bg-amber-500/10 text-amber-600 border-amber-500/20"
              )}
            >
              {task.type === "scheduled-message" ? "Mensagem" : "Follow-up"}
            </Badge>
          </div>

          {/* Row 2: Lead + Date + Priority */}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[12px] text-muted-foreground/60 truncate">
              {task.leadName}
              {task.leadCompany && ` · ${task.leadCompany}`}
            </span>
            <span className="ml-auto flex items-center gap-1.5 shrink-0">
              <span className={cn(
                "text-[12px] tabular-nums",
                isOverdue ? "text-destructive font-medium" : "text-muted-foreground/50"
              )}>
                {task.isCompleted && task.completedAt
                  ? `Concluído ${format(task.completedAt, "HH:mm")}`
                  : formatTaskDate(task.scheduledAt)}
              </span>
              <PriorityDot priority={task.priority} />
            </span>
          </div>
        </div>

        {/* Expand indicator */}
        <div className="pt-1 opacity-0 group-hover:opacity-40 transition-opacity">
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </div>
      </div>

      {/* Completion Banner (follow-up only) */}
      <AnimatePresence>
        {showCompletionBanner && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 mx-2 mb-2 px-4 py-2.5 rounded-lg bg-success/5 border border-success/20">
              <span className="text-sm text-foreground/80">
                Concluído · Enviar mensagem para o lead?
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setScheduleModalOpen(true);
                    setShowCompletionBanner(false);
                  }}
                >
                  Agendar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={(e) => { e.stopPropagation(); handleSkipBanner(); }}
                >
                  Pular
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && !task.isCompleted && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="ml-9 mr-2 mb-3 p-3 rounded-lg bg-muted/20 border border-border/50 space-y-2">
              {/* Description / Message content */}
              {task.type === "follow-up" && task.description && (
                <p className="text-sm text-muted-foreground">{task.description}</p>
              )}
              {task.type === "scheduled-message" && task.messageContent && (
                <div className="text-sm text-muted-foreground bg-background rounded-md p-2 border border-border/30">
                  {task.messageContent}
                </div>
              )}
              {task.type === "scheduled-message" && task.mediaUrl && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{task.mediaType || "mídia"}</span>
                  <span>anexado</span>
                </div>
              )}

              {/* Meta info */}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground/50">
                {task.assignedToName && (
                  <span>Responsável: {task.assignedToName}</span>
                )}
                {task.sourcePipe && (
                  <span className="flex items-center gap-1">
                    {(() => { const Icon = PIPE_ICONS[task.sourcePipe] || MessageSquare; return <Icon className="w-3 h-3" />; })()}
                    {task.sourcePipe === "whatsapp" ? "WhatsApp" : task.sourcePipe === "confirmacao" ? "Confirmação" : "Propostas"}
                  </span>
                )}
                {task.isAutomated && (
                  <span className="flex items-center gap-1">
                    <Bot className="w-3 h-3" /> Auto
                  </span>
                )}
                {task.type === "scheduled-message" && task.status === "failed" && (
                  <span className="text-destructive font-medium">Falhou</span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                {hasPhone && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={(e) => { e.stopPropagation(); openWhatsApp(task.leadPhone); }}
                  >
                    <ExternalLink className="w-3 h-3" /> WhatsApp
                  </Button>
                )}
                {task.type === "follow-up" && onArchive && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); onArchive(task.id); }}
                  >
                    Arquivar
                  </Button>
                )}
                {task.type === "scheduled-message" && onCancel && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); onCancel(task.id); }}
                  >
                    Cancelar envio
                  </Button>
                )}
                {canDelete && onDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
                  >
                    Excluir
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Schedule message modal (from completion banner) */}
      <ScheduleMessageModal
        open={scheduleModalOpen}
        onOpenChange={setScheduleModalOpen}
        leadId={task.leadId}
        leadName={task.leadName}
        phoneNumber={task.leadPhone || ""}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/revisao/RevisionItem.tsx
git commit -m "feat(revisao): add RevisionItem checklist component"
```

---

## Task 3: Revisao page

**Files:**
- Create: `src/pages/Revisao.tsx`

- [ ] **Step 1: Criar página**

```typescript
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Search, Lightbulb, Plus, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
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
import { ScheduleFollowUpModal } from "@/components/followups/ScheduleFollowUpModal";
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
import { AutomationSettings } from "@/components/followups/AutomationSettings";
import { useFollowUps, useCompleteFollowUp, useArchiveFollowUp, useDeleteFollowUp } from "@/hooks/useFollowUps";
import { useMyScheduledMessages, useCancelScheduledMessage } from "@/hooks/useScheduledMessages";
import { useDailyPriorities } from "@/hooks/useDailyPriorities";
import { useTeamMembers, useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useUserRole, useFeaturePermission } from "@/hooks/useUserRole";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useOrganization } from "@/hooks/useOrganization";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, MessageSquare, ListChecks, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const logAction = useLogLeadAction();

  // Effective filter: "mine" = current member, "all" = no filter
  const effectiveAssignedTo = assignedTo === "mine" ? currentMember?.id : assignedTo === "all" ? undefined : assignedTo;

  // Data
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

  // Mutations
  const completeFollowUp = useCompleteFollowUp();
  const archiveFollowUp = useArchiveFollowUp();
  const deleteFollowUp = useDeleteFollowUp();
  const cancelMessage = useCancelScheduledMessage();

  // Merge into RevisionTask[]
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

  // Filtered views
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

  const pendingTasks = (list: RevisionTask[]) => list.filter((t) => !t.isCompleted);
  const completedTasks = (list: RevisionTask[]) => list.filter((t) => t.isCompleted);

  // Handlers
  const handleComplete = (id: string, type: string) => {
    if (type === "follow-up") {
      completeFollowUp.mutate(id);
    } else {
      cancelMessage.mutate(id);
    }
  };

  const handleArchive = (id: string) => {
    archiveFollowUp.mutate(id);
  };

  const handleDelete = (id: string) => {
    deleteFollowUp.mutate(id);
  };

  const handleCancelMessage = (id: string) => {
    cancelMessage.mutate(id);
  };

  const isLoading = fuLoading || smLoading;

  // Render task list
  const renderList = (tasks: RevisionTask[]) => {
    const pending = pendingTasks(tasks);
    const completed = completedTasks(tasks);

    if (pending.length === 0 && completed.length === 0) {
      return null; // handled by empty state per tab
    }

    return (
      <div>
        {pending.map((task) => (
          <RevisionItem
            key={`${task.type}-${task.id}`}
            task={task}
            onComplete={(id) => handleComplete(id, task.type)}
            onCancel={task.type === "scheduled-message" ? handleCancelMessage : undefined}
            onArchive={task.type === "follow-up" ? handleArchive : undefined}
            onDelete={task.type === "follow-up" ? handleDelete : undefined}
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
      {/* Header */}
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

      {/* Tabs + Filters */}
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
            {/* Tab: Tudo */}
            <TabsContent value="all" className="mt-4">
              {/* Suggestions */}
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
                        <div key={lead.id} className="flex items-center justify-between px-3 py-1.5 rounded-md bg-card border border-border text-xs">
                          <span className="text-muted-foreground">
                            Lead sem contato: <span className="text-foreground font-medium">{lead.name}</span>
                            {lead.company && ` · ${lead.company}`}
                          </span>
                        </div>
                      ))}
                      {priorities.followups_vencidos?.slice(0, 3).map((fu) => (
                        <div key={fu.id} className="flex items-center justify-between px-3 py-1.5 rounded-md bg-card border border-border text-xs">
                          <span className="text-muted-foreground">
                            Follow-up vencido: <span className="text-foreground font-medium">{fu.lead?.name || fu.title}</span>
                            {` · ${fu.days_overdue}d atrás`}
                          </span>
                        </div>
                      ))}
                      {priorities.leads_quentes?.slice(0, 3).map((lead) => (
                        <div key={lead.id} className="flex items-center justify-between px-3 py-1.5 rounded-md bg-card border border-border text-xs">
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

              {filteredTasks.length === 0 && !isLoading ? (
                <EmptyState
                  icon={ClipboardList}
                  title="Nenhuma tarefa pendente"
                  description="Sua pista está limpa."
                />
              ) : (
                renderList(filteredTasks)
              )}
            </TabsContent>

            {/* Tab: Mensagens */}
            <TabsContent value="messages" className="mt-4">
              {messageTasks.length === 0 && !isLoading ? (
                <EmptyState
                  icon={MessageSquare}
                  title="Nenhuma mensagem agendada"
                  description="Agende mensagens pelo chat ou pelo modal do lead."
                />
              ) : (
                renderList(messageTasks)
              )}
            </TabsContent>

            {/* Tab: Follow-ups */}
            <TabsContent value="followups" className="mt-4">
              {followUpTasks.length === 0 && !isLoading ? (
                <EmptyState
                  icon={ListChecks}
                  title="Nenhum follow-up pendente"
                  description="Crie follow-ups nos funis ou no drawer do lead."
                />
              ) : (
                renderList(followUpTasks)
              )}
            </TabsContent>
          </>
        )}
      </Tabs>

      {/* Automation Settings (admin only) */}
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
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Revisao.tsx
git commit -m "feat(revisao): add Revisao page with tabs, checklist, and suggestions"
```

---

## Task 4: Reativar navegação e rota

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/TopNavigation.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Sidebar — descomentar Revisão**

Em `src/components/layout/Sidebar.tsx`, encontrar:
```typescript
  // { label: "Revisão", icon: Wrench, path: "/follow-ups" },
```
E descomentar para:
```typescript
  { label: "Revisão", icon: Wrench, path: "/follow-ups" },
```

- [ ] **Step 2: TopNavigation — descomentar Revisão**

Em `src/components/layout/TopNavigation.tsx`, encontrar todas as linhas comentadas com "Revisão" e descomentar. Há 2-3 instâncias (primaryNavItems/moreNavItems, allNavItems).

- [ ] **Step 3: App.tsx — trocar componente na rota**

Em `src/App.tsx`, encontrar o import de `PipeFollowUps`:
```typescript
const PipeFollowUps = lazy(() => import("./pages/PipeFollowUps"));
```
E adicionar o import do Revisao (manter o PipeFollowUps como referência):
```typescript
const Revisao = lazy(() => import("./pages/Revisao"));
```

Na rota `/follow-ups`, trocar:
```typescript
<PipeFollowUps />
```
Por:
```typescript
<Revisao />
```

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Sidebar.tsx src/components/layout/TopNavigation.tsx src/App.tsx
git commit -m "feat(nav): reactivate Revisão tab and update route to new page"
```

---

## Task 5: Verificação final

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: Zero erros.

- [ ] **Step 2: Build**

Run: `npx vite build`
Expected: Build completo sem erros.

- [ ] **Step 3: Commit final (se houver fixes)**

```bash
git add -A
git commit -m "fix: resolve build issues from Revisão redesign"
```

- [ ] **Step 4: Push**

```bash
git push origin develop
```
