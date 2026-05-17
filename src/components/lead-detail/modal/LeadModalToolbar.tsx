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
import { ScheduleFollowUpButton } from "@/components/followups/ScheduleFollowUpButton";
import { useOpenWhatsAppChat, formatPhoneForWhatsApp } from "@/lib/whatsapp";
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
  const openWhatsApp = useOpenWhatsAppChat();

  return (
    <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-border/40 bg-card/20">
      {lead.phone && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs bg-emerald-500/5 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15"
          onClick={() => openWhatsApp(formatPhoneForWhatsApp(lead.phone!) ?? lead.phone!)}
        >
          <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
        </Button>
      )}
      {lead.phone && (
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
          <a href={`tel:${lead.phone.replace(/\D/g, "")}`}>
            <Phone className="w-3.5 h-3.5" /> Ligar
          </a>
        </Button>
      )}
      {lead.email && (
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
            <DropdownMenuItem onClick={onOpenCallModal}>
              <PhoneCall className="w-3.5 h-3.5 mr-2" /> Registrar ligação
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenEmailWriter}>
              <Mail className="w-3.5 h-3.5 mr-2" /> Email com IA
            </DropdownMenuItem>
            {lead.phone && (
              <>
                <DropdownMenuItem onClick={onOpenScheduleModal}>
                  <Clock className="w-3.5 h-3.5 mr-2" /> Agendar mensagem
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/chat-whatsapp?phone=${encodeURIComponent(formatPhoneForWhatsApp(lead.phone) ?? lead.phone)}`} onClick={onClose}>
                    <Send className="w-3.5 h-3.5 mr-2" /> Abrir conversa
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenSmsDialog}>
                  <Phone className="w-3.5 h-3.5 mr-2" /> Enviar SMS
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="w-3.5 h-3.5 mr-2" /> Excluir lead
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});
