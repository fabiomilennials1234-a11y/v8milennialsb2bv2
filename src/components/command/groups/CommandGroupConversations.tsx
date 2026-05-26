/**
 * CommandGroupConversations — grupo de conversas no Command Palette.
 *
 * C27: busca local por nome/telefone/empresa nos contatos do WhatsApp.
 * Só renderiza quando há instância selecionada (context-aware).
 * onClick: navigate(/chat?phone=...&instance=...) + close.
 */
import { useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { CommandGroup, CommandItem } from "cmdk";
import { cn } from "@/lib/utils";
import { useAuth } from "@/modules/identity";
import { pushRecent } from "../recentCommands";

// Importar hook de contatos — usa cache existente do TanStack Query
// sem nova query, apenas leitura do cache via hook
import { useWhatsAppContacts } from "@/hooks/chat/useWhatsAppContacts";
import { useWhatsAppInstancesForUser } from "@/hooks/chat/useWhatsAppInstances";

interface CommandGroupConversationsProps {
  onClose: () => void;
}

export function CommandGroupConversations({ onClose }: CommandGroupConversationsProps) {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Pegar a primeira instância disponível para o usuário
  const { data: instances } = useWhatsAppInstancesForUser();
  const firstInstance = instances?.[0] ?? null;
  const instanceId = firstInstance?.id ?? null;

  const { data: contacts } = useWhatsAppContacts(instanceId);

  if (!contacts || contacts.length === 0) return null;

  const handleSelect = (id: string, phone: string) => {
    if (user?.id) pushRecent(user.id, id);
    navigate(`/chat?phone=${phone}&instance=${instanceId}`);
    onClose();
  };

  // Mostrar até 5 conversas mais recentes no palette
  const recentContacts = contacts.slice(0, 5);

  return (
    <CommandGroup
      heading="Conversas recentes"
      className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5"
    >
      {recentContacts.map((contact) => {
        const displayName =
          contact.lead_name ||
          contact.push_name ||
          contact.phone_number;
        const id = `conv-${contact.phone_number}`;

        return (
          <CommandItem
            key={id}
            value={`${id} ${displayName} ${contact.phone_number}`}
            onSelect={() => handleSelect(id, contact.phone_number)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md mx-1",
              "cursor-default select-none",
              "aria-selected:bg-muted/60",
              "hover:bg-muted/40",
              "transition-colors duration-75"
            )}
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium leading-tight truncate text-foreground">
                {displayName}
              </span>
              {contact.last_message && (
                <span className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
                  {contact.last_message}
                </span>
              )}
            </div>
            {contact.unread_count > 0 && (
              <span className="shrink-0 bg-primary text-primary-foreground text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 tabular-nums font-medium">
                {contact.unread_count}
              </span>
            )}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
