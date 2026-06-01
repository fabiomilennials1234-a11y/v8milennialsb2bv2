import {
  ArrowRight, ArrowDown, ArrowUp, Bot, Calendar, CalendarX, CheckCircle,
  CheckSquare, ChevronRight, DollarSign, Edit2, ExternalLink, FileText,
  History, Layers, ListTodo, Mail, MessageSquare, Package, Phone, Play,
  Plus, Send, Tag, Trash2, TrendingUp, UserCheck, UserPlus, XCircle, Zap,
} from "lucide-react";

export type LeadHistoryIconConfig = {
  icon: React.ElementType;
  label: string;
  tone: string;
  /** True para entradas de mensagem inbound (recebida do lead). */
  inbound?: boolean;
};

/**
 * Mapeamento action → ícone/cor/label usado pela ActivityFeed agrupada.
 * Pós-#311: deduplica o ACTION_CONFIG que vivia em TimelineItem/Client-
 * DetailModal. Mantém visual distinto para inbound vs outbound (WhatsApp,
 * SMS, email).
 */
export const LEAD_HISTORY_ICONS: Record<string, LeadHistoryIconConfig> = {
  // Lead lifecycle
  lead_created:           { icon: UserPlus, label: "Lead criado", tone: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  stage_changed:          { icon: ArrowRight, label: "Stage", tone: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  sdr_assigned:           { icon: UserCheck, label: "Responsável", tone: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  closer_assigned:        { icon: UserCheck, label: "Vendedor", tone: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  responsible_assigned:   { icon: UserCheck, label: "Responsável", tone: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  field_updated:          { icon: Edit2, label: "Campo", tone: "bg-muted text-muted-foreground border-border/40" },

  // Pipe ops
  pipe_added:             { icon: Plus, label: "Pipe", tone: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  pipe_removed:           { icon: Trash2, label: "Pipe", tone: "bg-red-500/15 text-red-500 border-red-500/30" },

  // Meeting
  meeting_scheduled:      { icon: Calendar, label: "Reunião", tone: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  meeting_attended:       { icon: CheckCircle, label: "Compareceu", tone: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  meeting_missed:         { icon: XCircle, label: "Não compareceu", tone: "bg-red-500/15 text-red-500 border-red-500/30" },
  meeting_deleted:        { icon: CalendarX, label: "Reunião removida", tone: "bg-red-500/15 text-red-500 border-red-500/30" },

  // Proposal
  proposal_created:       { icon: DollarSign, label: "Proposta", tone: "bg-purple-500/15 text-purple-500 border-purple-500/30" },
  proposal_status_changed:{ icon: TrendingUp, label: "Status proposta", tone: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  proposal_deleted:       { icon: Trash2, label: "Proposta removida", tone: "bg-red-500/15 text-red-500 border-red-500/30" },

  // Followup / actions
  followup_created:       { icon: ListTodo, label: "Follow-up", tone: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  followup_completed:     { icon: CheckSquare, label: "Follow-up", tone: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  product_linked:         { icon: Package, label: "Produto", tone: "bg-purple-500/15 text-purple-500 border-purple-500/30" },

  // IA / copilot
  ai_toggled:             { icon: Bot, label: "IA", tone: "bg-muted text-muted-foreground border-border/40" },
  copilot_interaction:    { icon: Bot, label: "Copilot", tone: "bg-cyan-500/15 text-cyan-500 border-cyan-500/30" },

  // Messaging — outbound default
  whatsapp_sent:          { icon: MessageSquare, label: "WhatsApp", tone: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  whatsapp_received:      { icon: MessageSquare, label: "WhatsApp", tone: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30", inbound: true },
  sms_sent:               { icon: Send, label: "SMS", tone: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  sms_received:           { icon: Send, label: "SMS", tone: "bg-blue-500/15 text-blue-500 border-blue-500/30", inbound: true },
  email_sent:             { icon: Mail, label: "Email", tone: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30" },
  email_received:         { icon: Mail, label: "Email", tone: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30", inbound: true },
  call_logged:            { icon: Phone, label: "Ligação", tone: "bg-violet-500/15 text-violet-500 border-violet-500/30" },

  // Tag
  tag_added:              { icon: Tag, label: "Tag", tone: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  tag_removed:            { icon: Tag, label: "Tag", tone: "bg-muted text-muted-foreground border-border/40" },

  // Automation
  automation_triggered:   { icon: Zap, label: "Automação", tone: "bg-fuchsia-500/15 text-fuchsia-500 border-fuchsia-500/30" },
};

export const DEFAULT_ICON: LeadHistoryIconConfig = {
  icon: History,
  label: "Atividade",
  tone: "bg-muted text-muted-foreground border-border/40",
};

export function getIconForAction(action: string | null | undefined): LeadHistoryIconConfig {
  if (!action) return DEFAULT_ICON;
  return LEAD_HISTORY_ICONS[action] ?? DEFAULT_ICON;
}

// Re-export for tests/debug
export { ArrowDown, ArrowUp, ChevronRight, ExternalLink, FileText, Layers, Play };
