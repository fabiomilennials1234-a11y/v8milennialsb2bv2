/**
 * ConversationListItem — linha de conversa no inbox + ContactContextMenu co-locado.
 *
 * Extraído de WhatsAppChat.tsx (C5).
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  MoreVertical,
  Tag,
  Archive,
  ArchiveRestore,
  Trash2,
  Check,
  Bot,
  Zap,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { ChatContact } from "@/hooks/useWhatsAppChat";
import { ChannelBadge } from "../ChannelBadge";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function contactDisplayName(c: ChatContact): string {
  return (c.push_name || c.lead_name || c.phone_number || "").trim() || "Contato";
}

export function formatContactTime(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isToday) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (isYesterday) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// ─── ContactContextMenu ───────────────────────────────────────────────────────

interface ContactContextMenuProps {
  contact: ChatContact;
  activeTab: "active" | "archived";
  isAdmin: boolean;
  instanceId: string | null;
  organizationId: string | null;
  allTags: { id: string; name: string; color: string }[];
  onArchive: (phone: string) => void;
  onUnarchive: (conversationId: string) => void;
  onDelete: (phone: string) => void;
  onAddTag: (phone: string, tagId: string) => void;
  onRemoveTag: (conversationId: string, tagId: string) => void;
}

function ContactContextMenu({
  contact,
  activeTab,
  isAdmin,
  allTags,
  onArchive,
  onUnarchive,
  onDelete,
  onAddTag,
  onRemoveTag,
}: ContactContextMenuProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const contactTagIds = new Set(contact.tags.map((t) => t.id));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="p-1 rounded-md hover:bg-muted/80 transition-colors"
            aria-label="Opções da conversa"
          >
            <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Tag className="w-4 h-4 mr-2" />
              Gerenciar tags
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52 p-1" onClick={(e) => e.stopPropagation()}>
              {allTags.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-2">Nenhuma tag criada</p>
              ) : (
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {allTags.map((tag) => {
                    const isActive = contactTagIds.has(tag.id);
                    return (
                      <DropdownMenuItem
                        key={tag.id}
                        className={cn(
                          "flex items-center gap-2 cursor-pointer",
                          isActive && "bg-primary/10",
                        )}
                        onSelect={(e) => {
                          e.preventDefault();
                          if (isActive && contact.conversation_id) {
                            onRemoveTag(contact.conversation_id, tag.id);
                          } else {
                            onAddTag(contact.phone_number, tag.id);
                          }
                        }}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0 border"
                          style={{
                            backgroundColor: isActive ? tag.color : "transparent",
                            borderColor: tag.color,
                          }}
                        />
                        <span className="truncate">{tag.name}</span>
                        {isActive && <Check className="w-3 h-3 ml-auto shrink-0 text-primary" />}
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {activeTab === "active" ? (
            <DropdownMenuItem onClick={() => onArchive(contact.phone_number)}>
              <Archive className="w-4 h-4 mr-2" />
              Arquivar conversa
            </DropdownMenuItem>
          ) : (
            contact.conversation_id && (
              <DropdownMenuItem onClick={() => onUnarchive(contact.conversation_id!)}>
                <ArchiveRestore className="w-4 h-4 mr-2" />
                Desarquivar conversa
              </DropdownMenuItem>
            )
          )}

          {isAdmin && activeTab === "active" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Excluir conversa
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa</AlertDialogTitle>
            <AlertDialogDescription>
              Essa conversa será removida da lista para todos os membros da organização.
              As mensagens serão permanentemente apagadas após 30 dias.
              Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDelete(contact.phone_number);
                setShowDeleteConfirm(false);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── ConversationListItem ─────────────────────────────────────────────────────

export interface ConversationListItemProps {
  contact: ChatContact;
  isSelected: boolean;
  onSelect: (phone: string) => void;
  waitingHumanLeadIds?: Set<string>;
  activeTab: "active" | "archived";
  isAdmin: boolean;
  instanceId: string | null;
  organizationId: string | null;
  allTags: { id: string; name: string; color: string }[];
  onArchive: (phone: string) => void;
  onUnarchive: (conversationId: string) => void;
  onDelete: (phone: string) => void;
  onAddTag: (phone: string, tagId: string) => void;
  onRemoveTag: (conversationId: string, tagId: string) => void;
}

export function ConversationListItem({
  contact,
  isSelected,
  onSelect,
  activeTab,
  isAdmin,
  instanceId,
  organizationId,
  allTags,
  onArchive,
  onUnarchive,
  onDelete,
  onAddTag,
  onRemoveTag,
}: ConversationListItemProps) {
  const displayName = contactDisplayName(contact);

  return (
    <motion.div
      key={contact.phone_number}
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
      aria-label={`Conversa com ${displayName}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(contact.phone_number);
        }
      }}
      className={cn(
        "w-full px-3 py-3 text-left transition-colors rounded-none border-l-2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-10 focus-visible:relative",
        isSelected
          ? "bg-primary/15 border-l-primary"
          : contact.unread_count > 0
            ? "bg-amber-50 dark:bg-amber-950/30 border-l-amber-500 hover:bg-amber-100 dark:hover:bg-amber-950/50"
            : "hover:bg-muted/50 border-l-transparent",
      )}
      whileTap={{ scale: 0.99 }}
      onClick={() => onSelect(contact.phone_number)}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar className="w-11 h-11 rounded-full border-2 border-background shadow-sm">
            <AvatarFallback className="bg-primary/10 text-primary font-medium text-sm">
              {(displayName.charAt(0) || "?").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <ChannelBadge channel="whatsapp" size={18} overlay />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="font-semibold text-foreground truncate text-sm flex items-center gap-1">
              <span className="truncate">{displayName}</span>
              <ContactContextMenu
                contact={contact}
                activeTab={activeTab}
                isAdmin={isAdmin}
                instanceId={instanceId}
                organizationId={organizationId}
                allTags={allTags}
                onArchive={onArchive}
                onUnarchive={onUnarchive}
                onDelete={onDelete}
                onAddTag={onAddTag}
                onRemoveTag={onRemoveTag}
              />
              {!contact.lead_id && (
                <span className="w-2 h-2 rounded-full bg-primary/60 shrink-0" title="Novo" />
              )}
              {contact.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag.id}
                  className="text-[10px] px-1.5 py-0.5 rounded-full leading-none shrink-0 whitespace-nowrap"
                  style={{
                    backgroundColor: `${tag.color}20`,
                    color: tag.color,
                    border: `1px solid ${tag.color}40`,
                  }}
                >
                  {tag.name}
                </span>
              ))}
              {contact.tags.length > 2 && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  +{contact.tags.length - 2}
                </span>
              )}
            </span>
            <time
              dateTime={contact.last_message_time || ""}
              className="text-xs text-muted-foreground whitespace-nowrap shrink-0 tabular-nums"
            >
              {formatContactTime(contact.last_message_time)}
            </time>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className="text-[12px] text-muted-foreground/60 truncate flex-1 min-w-0 flex items-center gap-1">
              {contact.last_message_direction === "outgoing" && contact.last_message_sent_source === "workflow" && (
                <Zap className="h-2.5 w-2.5 text-[#a78bfa] shrink-0" />
              )}
              {contact.last_message_direction === "outgoing" && contact.last_message_sent_source === "copilot" && (
                <Bot className="h-2.5 w-2.5 text-[#fbbf24] shrink-0" />
              )}
              {contact.last_message_direction === "outgoing" && (!contact.last_message_sent_source || contact.last_message_sent_source === "manual") && (
                <span className="text-foreground/50 shrink-0" title="Você enviou">
                  Você:
                </span>
              )}
              <span className="truncate min-w-0">{contact.last_message || "Sem mensagens"}</span>
            </p>
            {contact.unread_count > 0 && !isSelected && (
              <Badge
                className="h-5 min-w-5 px-1.5 shrink-0 text-xs bg-amber-500 text-white border-0 hover:bg-amber-600"
                title="Mensagens não lidas"
              >
                {contact.unread_count > 99 ? "99+" : contact.unread_count}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
