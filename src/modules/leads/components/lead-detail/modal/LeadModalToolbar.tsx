import { memo } from "react";
import {
  MessageSquare, Phone, Mail, Bot, MoreVertical, Clock,
  Send, PhoneCall, Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScheduleFollowUpButton } from "@/modules/engagement/components/followups/ScheduleFollowUpButton";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { EMAIL_CHANNEL_AVAILABLE, SMS_CHANNEL_AVAILABLE } from "@/modules/communication/lib/channel-availability";
import { useLeadActionGates } from "../hooks/useLeadActionGates";
import { cn } from "@/lib/utils";

interface LeadModalToolbarProps {
  lead: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    responsible_id?: string | null;
  };
  aiDisabled: boolean;
  onToggleAI: (enabled: boolean) => void;
  onOpenCallModal: () => void;
  onOpenEmailComposer: () => void;
  onOpenEmailWriter: () => void;
  onOpenScheduleModal: () => void;
  onOpenSmsDialog: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export const LeadModalToolbar = memo(function LeadModalToolbar({
  lead, aiDisabled, onToggleAI,
  onOpenCallModal, onOpenEmailComposer, onOpenEmailWriter,
  onOpenScheduleModal, onOpenSmsDialog, onDelete, onClose,
}: LeadModalToolbarProps) {
  const gates = useLeadActionGates(lead.id);
  // "Send message" gate (granular key pending) — for now derive from canEditField:
  // an active member who can edit a lead can also send outbound messages.
  // canMention is reserved for collaboration features (comment mentions).
  const canSendMessage = gates.canEditField.allowed;

  return (
    <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-border/40 bg-card/20">
      {lead.phone && canSendMessage && (
        <AbrirConversaButton
          leadId={lead.id}
          phone={lead.phone}
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs bg-emerald-500/5 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15"
        >
          <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
        </AbrirConversaButton>
      )}
      {lead.phone && canSendMessage && (
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
          <a href={`tel:${lead.phone.replace(/\D/g, "")}`}>
            <Phone className="w-3.5 h-3.5" /> Ligar
          </a>
        </Button>
      )}
      {EMAIL_CHANNEL_AVAILABLE && lead.email && canSendMessage && (
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onOpenEmailComposer}>
          <Mail className="w-3.5 h-3.5" /> Email
        </Button>
      )}
      <ScheduleFollowUpButton
        leadId={lead.id}
        leadName={lead.name}
        defaultAssignedTo={lead.responsible_id || undefined}
        variant="button"
        size="sm"
      />

      <div className="flex items-center gap-2 ml-2 pl-2.5 border-l border-border/40">
        <Bot className={cn("w-3.5 h-3.5", aiDisabled ? "text-muted-foreground/40" : "text-primary")} />
        <Switch
          checked={!aiDisabled}
          onCheckedChange={onToggleAI}
          className="scale-90 origin-left"
        />
        <span className="text-[11px] text-muted-foreground">IA</span>
      </div>

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {canSendMessage && (
              <>
                <DropdownMenuItem onClick={onOpenCallModal}>
                  <PhoneCall className="w-3.5 h-3.5 mr-2" /> Registrar ligação
                </DropdownMenuItem>
                {EMAIL_CHANNEL_AVAILABLE && (
                  <DropdownMenuItem onClick={onOpenEmailWriter}>
                    <Mail className="w-3.5 h-3.5 mr-2" /> Email com IA
                  </DropdownMenuItem>
                )}
              </>
            )}
            {lead.phone && canSendMessage && (
              <>
                <DropdownMenuItem onClick={onOpenScheduleModal}>
                  <Clock className="w-3.5 h-3.5 mr-2" /> Agendar mensagem
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/chat-whatsapp?phone=${encodeURIComponent(formatPhoneForWhatsApp(lead.phone) ?? lead.phone)}`} onClick={onClose}>
                    <Send className="w-3.5 h-3.5 mr-2" /> Abrir conversa
                  </Link>
                </DropdownMenuItem>
                {SMS_CHANNEL_AVAILABLE && (
                  <DropdownMenuItem onClick={onOpenSmsDialog}>
                    <Phone className="w-3.5 h-3.5 mr-2" /> Enviar SMS
                  </DropdownMenuItem>
                )}
              </>
            )}
            {gates.canDelete.allowed && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Excluir lead
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});
