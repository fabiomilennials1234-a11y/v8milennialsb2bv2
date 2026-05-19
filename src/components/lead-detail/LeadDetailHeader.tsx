import { memo } from "react";
import {
  MessageSquare, Mail, Phone, PhoneCall, Send, Clock,
  Bot, MoreVertical, Flame, X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScheduleFollowUpButton } from "@/components/followups/ScheduleFollowUpButton";
import { ORIGIN_COLORS } from "@/components/leads/LeadCard";
import { StageProgressBar } from "./StageProgressBar";
import { cn } from "@/lib/utils";
import { useOpenWhatsAppChat, formatPhoneForWhatsApp } from "@/lib/whatsapp";
import type { DrawerVariant } from "./legacy/drawer-variant";

const VARIANT_LABELS: Record<DrawerVariant, string> = {
  whatsapp: "Qualificação", confirmacao: "Confirmação", propostas: "Propostas",
  followup: "Follow-ups", custom: "Pipeline", upsell_client: "Upsell",
  upsell_campanha: "Upsell", leads: "Leads",
};

interface LeadDetailHeaderProps {
  lead: any;
  variant: DrawerVariant;
  stages: { id: string; name: string }[];
  currentStageId: string | null;
  currentAiDisabled: boolean;
  onToggleAI: (enabled: boolean) => void;
  onClose: () => void;
  onOpenScheduleModal: () => void;
  onOpenCallModal: () => void;
  onOpenEmailWriter: () => void;
  onOpenEmailComposer: () => void;
  onOpenSmsDialog: () => void;
  onDelete: () => void;
}

function initials(name: string | undefined) {
  return (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

export const LeadDetailHeader = memo(function LeadDetailHeader({
  lead, variant, stages, currentStageId, currentAiDisabled,
  onToggleAI, onClose, onOpenScheduleModal, onOpenCallModal,
  onOpenEmailWriter, onOpenEmailComposer, onOpenSmsDialog, onDelete,
}: LeadDetailHeaderProps) {
  const openWhatsApp = useOpenWhatsAppChat();
  const originColor = ORIGIN_COLORS[lead.origin] || ORIGIN_COLORS.outro;

  return (
    <div className="px-5 py-4 border-b border-border bg-gradient-to-r from-primary/5 to-transparent shrink-0">
      {/* Row 1: Avatar + Name + Close */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-black">{initials(lead.name)}</span>
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">{lead.name}</h2>
            <p className="text-xs text-muted-foreground truncate">
              {[lead.company, lead.phone, lead.email].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Row 2: Pills */}
      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
        {currentStageId && stages.length > 0 && (
          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
            {stages.find((s) => s.id === currentStageId)?.name || "—"}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px]">{VARIANT_LABELS[variant]}</Badge>
        <Badge variant="outline" className="text-[10px]" style={{ backgroundColor: originColor.bg, color: originColor.text, borderColor: `${originColor.text}30` }}>
          {originColor.label}
        </Badge>
        {lead.lead_tags?.map((lt: any) => lt.tag && (
          <Badge key={lt.tag.id} variant="outline" className="text-[10px]" style={{ backgroundColor: `${lt.tag.color}20`, color: lt.tag.color, borderColor: `${lt.tag.color}30` }}>
            {lt.tag.name}
          </Badge>
        ))}
        {lead.faturamento && (
          <Badge variant="outline" className="text-[10px]">
            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(Number(lead.faturamento))}
          </Badge>
        )}
        {lead.rating != null && lead.rating > 0 && (() => {
          const info = lead.rating >= 8
            ? { color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" }
            : lead.rating >= 4
            ? { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" }
            : { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" };
          return (
            <Badge variant="outline" className={cn("text-[10px] gap-0.5", info.bg)}>
              <Flame className={cn("w-2.5 h-2.5", info.color)} />
              <span className={info.color}>{lead.rating}</span>
            </Badge>
          );
        })()}
      </div>

      {/* Row 3: Stage progress bar */}
      <StageProgressBar stages={stages} currentStageId={currentStageId} />

      {/* Row 4: Actions */}
      <div className="flex items-center gap-1.5 mt-3">
        {lead.phone && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
            onClick={() => openWhatsApp(formatPhoneForWhatsApp(lead.phone) ?? lead.phone)}>
            <MessageSquare className="w-3 h-3" /> WhatsApp
          </Button>
        )}
        {lead.email && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onOpenEmailComposer}>
            <Mail className="w-3 h-3" /> Email
          </Button>
        )}
        {lead.phone && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
            <a href={`tel:${(lead.phone || "").replace(/\D/g, "")}`}>
              <Phone className="w-3 h-3" /> Ligar
            </a>
          </Button>
        )}
        {lead.id && (
          <ScheduleFollowUpButton leadId={lead.id} leadName={lead.name}
            defaultAssignedTo={lead.responsible_id || undefined} variant="button" size="sm" />
        )}
        <div className="flex items-center gap-1.5 ml-1 border-l border-border pl-1.5">
          <Switch checked={!currentAiDisabled} onCheckedChange={(checked) => onToggleAI(checked)}
            className="scale-75 origin-left" />
          <span className="text-[9px] text-muted-foreground">IA</span>
        </div>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreVertical className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpenCallModal}>
                <PhoneCall className="w-4 h-4 mr-2" /> Registrar ligação
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenEmailWriter}>
                <Mail className="w-4 h-4 mr-2" /> Email com IA
              </DropdownMenuItem>
              {lead.phone && (
                <>
                  <DropdownMenuItem onClick={onOpenScheduleModal}>
                    <Clock className="w-4 h-4 mr-2" /> Agendar mensagem
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={`/chat-whatsapp?phone=${encodeURIComponent(formatPhoneForWhatsApp(lead.phone) ?? lead.phone)}`} onClick={onClose}>
                      <Send className="w-4 h-4 mr-2" /> Enviar mensagem
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onOpenSmsDialog}>
                    <Phone className="w-4 h-4 mr-2" /> Enviar SMS
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                Excluir lead
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
});
