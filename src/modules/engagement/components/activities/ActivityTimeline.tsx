import { useState } from "react";
import {
  Phone,
  Mail,
  Calendar,
  StickyNote,
  CheckSquare,
  MessageSquare,
  Cpu,
  Plus,
  Clock,
  CheckCircle2,
  User,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useActivities,
  useLogActivity,
  type ActivityType,
  type ActivityWithNames,
} from "@/modules/engagement/hooks/useActivities";

// ─── Config ───────────────────────────────────────────────

const TYPE_CONFIG: Record<
  ActivityType,
  { icon: React.ElementType; label: string; color: string }
> = {
  // Só tokens: a cor separa o TIPO de relance e precisa valer no escuro.
  call: { icon: Phone, label: "Ligação", color: "bg-insights/10 text-insights" },
  email: { icon: Mail, label: "E-mail", color: "bg-silver/15 text-silver" },
  meeting: { icon: Calendar, label: "Reunião", color: "bg-primary-soft text-primary-soft-foreground" },
  note: { icon: StickyNote, label: "Nota", color: "bg-warning/15 text-warning-strong" },
  task: { icon: CheckSquare, label: "Tarefa", color: "bg-foreground/[.07] text-foreground/80" },
  whatsapp_msg: { icon: MessageSquare, label: "WhatsApp", color: "bg-success/10 text-success" },
  system: { icon: Cpu, label: "Sistema", color: "bg-muted text-muted-foreground" },
};

const FORM_TYPES: ActivityType[] = ["note", "call", "meeting", "task"];

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}min ${s}s` : `${s}s`;
}

// ─── Create Form ──────────────────────────────────────────

interface CreateFormProps {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  leadId?: string;
}

function CreateForm({ contactId, companyId, dealId, leadId }: CreateFormProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ActivityType>("note");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const logActivity = useLogActivity();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) return;

    logActivity.mutate(
      { type, subject: subject.trim(), description: description.trim() || undefined, contactId, companyId, dealId, leadId },
      {
        onSuccess: () => {
          toast.success("Atividade registrada");
          setSubject("");
          setDescription("");
          setOpen(false);
        },
        onError: () => toast.error("Erro ao registrar atividade"),
      }
    );
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full mb-4 gap-1.5 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="w-3.5 h-3.5" />
        Adicionar atividade
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-2xl bg-sunken p-3">
      <div className="flex gap-1.5 flex-wrap">
        {FORM_TYPES.map((t) => {
          const cfg = TYPE_CONFIG[t];
          const Icon = cfg.icon;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                type === t ? cn(cfg.color, "ring-1 ring-current") : "bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3 h-3" />
              {cfg.label}
            </button>
          );
        })}
      </div>

      <Input
        placeholder="Assunto"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="h-9 text-sm"
        autoFocus
      />

      <Textarea
        placeholder="Descrição (opcional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="min-h-[60px] text-sm resize-none"
        rows={2}
      />

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={!subject.trim() || logActivity.isPending}>
          {logActivity.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

// ─── Timeline Item ────────────────────────────────────────

function ActivityItem({ activity, isLast }: { activity: ActivityWithNames; isLast: boolean }) {
  const config = TYPE_CONFIG[activity.type] || TYPE_CONFIG.system;
  const Icon = config.icon;
  const isCompleted = !!activity.completed_at;

  return (
    <div className="flex gap-3">
      {/* Icon + vertical line */}
      <div className="flex flex-col items-center">
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", config.color)}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-1.5" />}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0", isLast ? "pb-0" : "pb-3")}>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="truncate text-sm font-semibold">{activity.subject || config.label}</p>

          {activity.type === "task" && isCompleted && (
            <Badge variant="success" className="gap-1 px-2 py-0 text-[10px]">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Concluída
            </Badge>
          )}

          {activity.type === "task" && activity.due_date && !isCompleted && (
            <Badge variant="warning" className="gap-1 px-2 py-0 text-[10px] tabular-nums">
              <Clock className="h-2.5 w-2.5" />
              {format(new Date(activity.due_date), "dd/MM", { locale: ptBR })}
            </Badge>
          )}

          {activity.outcome && (
            <Badge variant="soft" className="px-2 py-0 text-[10px]">
              {activity.outcome}
            </Badge>
          )}

          {activity.type === "call" && activity.duration_sec != null && activity.duration_sec > 0 && (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {formatDuration(activity.duration_sec)}
            </span>
          )}
        </div>

        {activity.description && (
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{activity.description}</p>
        )}

        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>
            {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true, locale: ptBR })}
          </span>
          {(activity.owner_email || activity.assigned_name) && (
            <>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1 truncate">
                <User className="w-2.5 h-2.5" />
                {activity.assigned_name || activity.owner_email}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────

interface ActivityTimelineProps {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  leadId?: string;
  limit?: number;
  showCreateForm?: boolean;
}

export function ActivityTimeline({
  contactId,
  companyId,
  dealId,
  leadId,
  limit,
  showCreateForm,
}: ActivityTimelineProps) {
  const { data, isLoading } = useActivities({ contactId, companyId, dealId, leadId, limit });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activities = data ?? [];

  return (
    <div>
      {showCreateForm && (
        <CreateForm contactId={contactId} companyId={companyId} dealId={dealId} leadId={leadId} />
      )}

      {activities.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Clock className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold">Nenhuma atividade registrada</p>
        </div>
      ) : (
        <div className="border-l-2 border-border ml-4">
          <div className="space-y-0 -ml-4">
            {activities.map((activity, i) => (
              <ActivityItem
                key={activity.id}
                activity={activity}
                isLast={i === activities.length - 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
