import { useState } from "react";
import {
  UserPlus,
  UserCheck,
  ArrowRight,
  Edit2,
  Calendar,
  CalendarX,
  Clock,
  TrendingUp,
  DollarSign,
  CheckCircle,
  CheckSquare,
  XCircle,
  Bot,
  Package,
  FileText,
  ListTodo,
  Trash2,
  Tag,
  Zap,
  ChevronDown,
  MessageSquare,
  ExternalLink,
  Play,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { TimelineEvent, TimelineSource } from "@/hooks/useLeadTimeline";

// ─── Config ───────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  lead_created: { icon: UserPlus, label: "Lead criado", color: "bg-blue-500/20 text-blue-600" },
  stage_changed: { icon: ArrowRight, label: "Etapa alterada", color: "bg-yellow-500/20 text-yellow-600" },
  sdr_assigned: { icon: UserCheck, label: "Responsável atribuído", color: "bg-green-500/20 text-green-600" },
  closer_assigned: { icon: UserCheck, label: "Vendedor atribuído", color: "bg-green-500/20 text-green-600" },
  responsible_assigned: { icon: UserCheck, label: "Responsável atribuído", color: "bg-green-500/20 text-green-600" },
  field_updated: { icon: Edit2, label: "Campo atualizado", color: "bg-muted text-muted-foreground" },
  note_added: { icon: FileText, label: "Nota adicionada", color: "bg-muted text-muted-foreground" },
  meeting_scheduled: { icon: Calendar, label: "Reunião agendada", color: "bg-blue-500/20 text-blue-600" },
  meeting_attended: { icon: CheckCircle, label: "Compareceu", color: "bg-green-500/20 text-green-600" },
  meeting_missed: { icon: XCircle, label: "Não compareceu", color: "bg-red-500/20 text-red-600" },
  meeting_deleted: { icon: CalendarX, label: "Reunião removida", color: "bg-red-500/20 text-red-600" },
  proposal_created: { icon: DollarSign, label: "Proposta criada", color: "bg-purple-500/20 text-purple-600" },
  proposal_status_changed: { icon: TrendingUp, label: "Status da proposta", color: "bg-yellow-500/20 text-yellow-600" },
  proposal_deleted: { icon: Trash2, label: "Proposta removida", color: "bg-red-500/20 text-red-600" },
  product_linked: { icon: Package, label: "Produto vinculado", color: "bg-purple-500/20 text-purple-600" },
  followup_created: { icon: ListTodo, label: "Tarefa criada", color: "bg-blue-500/20 text-blue-600" },
  followup_completed: { icon: CheckSquare, label: "Tarefa concluída", color: "bg-green-500/20 text-green-600" },
  ai_toggled: { icon: Bot, label: "IA", color: "bg-primary/20 text-primary" },
  copilot_interaction: { icon: Bot, label: "Copilot atendeu", color: "bg-primary/20 text-primary" },
  message_sent: { icon: MessageSquare, label: "Mensagem enviada", color: "bg-green-500/20 text-green-600" },
  automation_triggered: { icon: Zap, label: "Automação executada", color: "bg-orange-500/20 text-orange-600" },
  tag_added: { icon: Tag, label: "Tag adicionada", color: "bg-teal-500/20 text-teal-600" },
  tag_removed: { icon: Tag, label: "Tag removida", color: "bg-red-500/20 text-red-600" },
};

const FALLBACK_CONFIG = { icon: Clock, label: "", color: "bg-muted text-muted-foreground" };

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  agent: { label: "Copilot", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
  automation: { label: "Automação", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
  system: { label: "Sistema", className: "bg-muted text-muted-foreground border-border" },
};

const SOURCE_ICON_COLOR: Record<string, string> = {
  manual: "",
  agent: "bg-purple-500/20 text-purple-600",
  automation: "bg-orange-500/20 text-orange-600",
  system: "bg-muted text-muted-foreground",
};

// ─── Expandable Detail Renderers ──────────────────────────

function StageChangedDetail({ metadata }: { metadata: Record<string, unknown> }) {
  const fromStage = metadata.from_stage || metadata.from_status || metadata.old_status;
  const toStage = metadata.to_stage || metadata.to_status || metadata.new_status;
  const pipe = metadata.pipe_type || metadata.entity_type || metadata.pipe;

  return (
    <div className="flex items-center gap-2 text-xs">
      {fromStage && (
        <>
          <span className="px-2 py-0.5 rounded bg-muted">{String(fromStage)}</span>
          <ArrowRight className="w-3 h-3 text-muted-foreground" />
        </>
      )}
      {toStage && (
        <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">{String(toStage)}</span>
      )}
      {pipe && (
        <span className="text-muted-foreground ml-1">em {String(pipe)}</span>
      )}
    </div>
  );
}

function FieldUpdatedDetail({ metadata }: { metadata: Record<string, unknown> }) {
  const changes = metadata.changes as Record<string, { from?: unknown; to?: unknown }>
    || metadata.fields as Record<string, unknown>
    || null;

  if (!changes || typeof changes !== "object") {
    return metadata.field ? (
      <div className="text-xs text-muted-foreground">
        <span className="font-medium">{String(metadata.field)}</span>
        {metadata.old_value != null && <> de <span className="line-through">{String(metadata.old_value)}</span></>}
        {metadata.new_value != null && <> para <span className="font-medium">{String(metadata.new_value)}</span></>}
      </div>
    ) : null;
  }

  return (
    <div className="space-y-1">
      {Object.entries(changes).map(([field, val]) => (
        <div key={field} className="text-xs text-muted-foreground">
          <span className="font-medium">{field}</span>:{" "}
          {typeof val === "object" && val !== null ? (
            <>
              {(val as any).from != null && <span className="line-through">{String((val as any).from)}</span>}
              {(val as any).from != null && (val as any).to != null && " → "}
              {(val as any).to != null && <span className="font-medium text-foreground">{String((val as any).to)}</span>}
            </>
          ) : (
            <span className="font-medium text-foreground">{String(val)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function MeetingDetail({ metadata }: { metadata: Record<string, unknown> }) {
  const date = metadata.meeting_date || metadata.date || metadata.compromisso_date;
  const link = metadata.meet_link || metadata.meeting_link || metadata.link;

  return (
    <div className="space-y-1 text-xs">
      {date && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Calendar className="w-3 h-3" />
          {format(new Date(String(date)), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
        </div>
      )}
      {link && (
        <a
          href={String(link)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-primary hover:underline"
        >
          <ExternalLink className="w-3 h-3" />
          Link da reunião
        </a>
      )}
    </div>
  );
}

function MessageDetail({ metadata }: { metadata: Record<string, unknown> }) {
  const message = metadata.message || metadata.text || metadata.content;
  if (!message) return null;

  const text = String(message);
  return (
    <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 border-l-2 border-muted-foreground/20">
      {text.length > 100 ? text.slice(0, 100) + "…" : text}
    </div>
  );
}

function AutomationDetail({ metadata }: { metadata: Record<string, unknown> }) {
  const workflowName = metadata.workflow_name || metadata.automation_name;
  const actions = metadata.actions_executed as string[] | undefined;

  return (
    <div className="space-y-1 text-xs">
      {workflowName && (
        <div className="flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-orange-500" />
          <span className="font-medium">{String(workflowName)}</span>
        </div>
      )}
      {actions && Array.isArray(actions) && actions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {actions.map((a, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-600 text-[10px]">
              {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function GenericMetadataDetail({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(
    ([k]) => !["workflow_name", "automation_name", "actions_executed"].includes(k)
  );
  if (entries.length === 0) return null;

  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      {entries.slice(0, 6).map(([key, value]) => (
        <div key={key}>
          <span className="font-medium">{key}:</span>{" "}
          {typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}
        </div>
      ))}
      {entries.length > 6 && (
        <span className="text-[10px]">+{entries.length - 6} campos</span>
      )}
    </div>
  );
}

function ExpandedDetail({ event }: { event: TimelineEvent }) {
  const meta = event.metadata;
  if (!meta || Object.keys(meta).length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">Sem detalhes adicionais.</p>
    );
  }

  switch (event.action) {
    case "stage_changed":
      return <StageChangedDetail metadata={meta} />;
    case "field_updated":
      return <FieldUpdatedDetail metadata={meta} />;
    case "meeting_scheduled":
    case "meeting_attended":
    case "meeting_missed":
      return <MeetingDetail metadata={meta} />;
    case "message_sent":
    case "copilot_interaction":
      return <MessageDetail metadata={meta} />;
    case "automation_triggered":
      return <AutomationDetail metadata={meta} />;
    default:
      return <GenericMetadataDetail metadata={meta} />;
  }
}

// ─── TimelineItem Component ──────────────────────────────

interface TimelineItemProps {
  event: TimelineEvent;
  isLast?: boolean;
  compact?: boolean;
}

export function TimelineItem({ event, isLast, compact }: TimelineItemProps) {
  const [expanded, setExpanded] = useState(false);

  const config = ACTION_CONFIG[event.action] || FALLBACK_CONFIG;
  const displayLabel = config.label || event.action;
  const source = (event.source || "manual") as TimelineSource;
  const iconColor = (source !== "manual" && SOURCE_ICON_COLOR[source]) || config.color;
  const badge = source !== "manual" ? SOURCE_BADGE[source] : null;
  const hasExpandableContent = event.metadata && Object.keys(event.metadata).length > 0;

  // For automation source, show workflow name in badge
  const automationLabel = source === "automation" && event.metadata?.workflow_name
    ? `Automação: ${event.metadata.workflow_name}`
    : badge?.label;

  const IconComponent = config.icon;

  if (compact) {
    return (
      <div className="flex gap-2.5">
        <div className="flex flex-col items-center">
          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center shrink-0", iconColor)}>
            <IconComponent className="w-3 h-3" />
          </div>
          {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
        </div>
        <div className="flex-1 pb-3 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium truncate">{event.description || displayLabel}</p>
            {badge && (
              <span className={cn("text-[9px] px-1 py-0.5 rounded-full border font-medium shrink-0", badge.className)}>
                {automationLabel || badge.label}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true, locale: ptBR })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", iconColor)}>
          <IconComponent className="w-3.5 h-3.5" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-2" />}
      </div>
      <div className="flex-1 pb-6 min-w-0">
        <button
          type="button"
          className={cn(
            "w-full text-left",
            hasExpandableContent && "cursor-pointer hover:bg-muted/40 -mx-2 px-2 py-1 rounded-md transition-colors"
          )}
          onClick={() => hasExpandableContent && setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm">{displayLabel}</p>
            {badge && (
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0", badge.className)}>
                {automationLabel || badge.label}
              </span>
            )}
            {hasExpandableContent && (
              <ChevronDown className={cn(
                "w-3.5 h-3.5 text-muted-foreground transition-transform ml-auto shrink-0",
                expanded && "rotate-180"
              )} />
            )}
          </div>
          {event.description && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{event.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true, locale: ptBR })}
            {" · "}
            {format(new Date(event.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
          </p>
        </button>

        {expanded && (
          <div className="mt-2 ml-0 p-3 bg-muted/30 rounded-lg border border-border/50">
            <ExpandedDetail event={event} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Export configs for reuse ─────────────────────────────

export { ACTION_CONFIG, SOURCE_BADGE, SOURCE_ICON_COLOR, FALLBACK_CONFIG };
