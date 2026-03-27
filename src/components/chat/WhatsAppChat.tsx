import { useState, useRef, useEffect, useCallback, Component } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Send,
  Search,
  Phone,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  ArrowLeft,
  AlertCircle,
  UserCircle,
  Image as ImageIcon,
  Mic,
  MicOff,
  Pause,
  Play,
  X,
  FileImage,
  FileText,
  FileVideo,
  Download,
  File,
  Bot,
  Plus,
  Users,
  Filter,
  MoreVertical,
  Archive,
  ArchiveRestore,
  Trash2,
  Tag,
  Settings,
  UserPlus,
  ArrowRightLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useToggleLeadAI, useToggleConversationAI } from "@/hooks/useLeads";
import {
  useWhatsAppContacts,
  useWhatsAppMessages,
  useSendWhatsAppMessage,
  useSendWhatsAppMedia,
  useWhatsAppMessagesRealtime,
  useWhatsAppInstancesForUser,
  useTransferToSzChatDepartment,
  useActiveSzChatSession,
  type WhatsAppInstanceForUser,
  ChatContact,
  WhatsAppMessage,
} from "@/hooks/useWhatsAppChat";
import { convertAudioBlobToMp3, preloadLamejs } from "@/lib/audioToMp3";
import { useCanReplyOnInstanceByName } from "@/hooks/useWhatsAppInstanceAllowedMembers";
import { useLeadByPhone, useCreateLeadFromWhatsApp } from "@/hooks/useWhatsAppLeadIntegration";
import {
  useArchiveConversation,
  useUnarchiveConversation,
  useDeleteConversation,
  useAddConversationTag,
  useRemoveConversationTag,
  useWhatsAppConversationTags,
  useWhatsAppConversationsMeta,
} from "@/hooks/useWhatsAppConversations";
import { useTags } from "@/hooks/useTags";
import { useIsAdmin } from "@/hooks/useUserRole";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { ChannelBadge, type ChannelType } from "./ChannelBadge";
import { LeadDetailContent } from "./LeadDetailContent";
import { WhatsAppSettings } from "@/components/settings/WhatsAppSettings";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

/**
 * Para áudios no bucket "media" do Supabase, usa a Edge Function stream-media como proxy.
 * Isso evita CORS: o navegador recebe o áudio da mesma origem (Supabase Functions com CORS),
 * em vez de pedir direto ao Storage (que pode bloquear por CORS).
 */
function getAudioPlaybackUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl?.trim()) return mediaUrl;
  // Remover query e fragment para não enviar lixo ao stream-media
  const urlWithoutQuery = mediaUrl.split("?")[0].split("#")[0];
  const match = urlWithoutQuery.match(/\/object\/public\/media\/(.+)$/);
  if (!match) return mediaUrl;
  const path = match[1].replace(/\/$/, "");
  if (!path.startsWith("whatsapp-media/")) return mediaUrl;
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/stream-media?path=${encodeURIComponent(path)}`;
}

/** Error boundary só para a área de mensagens; evita "fewer hooks" ao não desmontar o ChatWindow */
class MessagesAreaErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[Chat] Error rendering messages:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] text-center p-6 gap-2">
          <AlertCircle className="w-10 h-10 text-destructive" />
          <p className="text-sm text-muted-foreground">Erro ao carregar mensagens.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function formatMessageTime(timestamp: string): string {
  if (!timestamp) return "--:--";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--";
  if (isToday(date)) {
    return format(date, "HH:mm");
  }
  if (isYesterday(date)) {
    return "Ontem " + format(date, "HH:mm");
  }
  return format(date, "dd/MM HH:mm");
}

function formatContactTime(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  if (isToday(date)) {
    return format(date, "HH:mm");
  }
  if (isYesterday(date)) {
    return "Ontem";
  }
  return format(date, "dd/MM", { locale: ptBR });
}

function MessageStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <Clock className="w-3 h-3 text-muted-foreground" />;
    case "sent":
      return <Check className="w-3 h-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="w-3 h-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="w-3 h-3 text-blue-500" />;
    default:
      return null;
  }
}

/** Nome de exibição do contato: prioriza push_name incoming (nome real do WhatsApp) sobre lead_name
 *  pois leads antigos podem ter sido criados com o nome do SDR por bug anterior */
function contactDisplayName(c: ChatContact): string {
  return (c.push_name || c.lead_name || c.phone_number || "").trim() || "Contato";
}

function ContactList({
  contacts,
  selectedPhone,
  onSelectContact,
  searchQuery,
  onSearchChange,
  isLoading,
  instances,
  selectedInstanceId,
  onSelectInstance,
  showOnlyWithLead,
  onToggleShowOnlyWithLead,
  showOnlyWaitingHuman,
  onToggleShowOnlyWaitingHuman,
  waitingHumanCount,
  waitingHumanLeadIds,
  activeTab,
  onTabChange,
  onArchive,
  onUnarchive,
  onDelete,
  isAdmin,
  instanceId,
  organizationId,
  allTags,
  onAddTag,
  onRemoveTag,
  onOpenInstances,
}: {
  contacts: ChatContact[];
  selectedPhone: string | null;
  onSelectContact: (phone: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isLoading: boolean;
  instances?: WhatsAppInstanceForUser[];
  selectedInstanceId?: string | null;
  onSelectInstance?: (instanceId: string) => void;
  showOnlyWithLead: boolean;
  onToggleShowOnlyWithLead: () => void;
  showOnlyWaitingHuman: boolean;
  onToggleShowOnlyWaitingHuman: () => void;
  waitingHumanCount: number;
  waitingHumanLeadIds?: Set<string>;
  activeTab: "active" | "archived";
  onTabChange: (tab: "active" | "archived") => void;
  onArchive: (phone: string) => void;
  onUnarchive: (conversationId: string) => void;
  onDelete: (phone: string) => void;
  isAdmin: boolean;
  instanceId: string | null;
  organizationId: string | null;
  allTags: { id: string; name: string; color: string }[];
  onAddTag: (phone: string, tagId: string) => void;
  onRemoveTag: (conversationId: string, tagId: string) => void;
  onOpenInstances?: () => void;
}) {
  const filteredContacts = contacts.filter((c) => {
    if (showOnlyWithLead && !c.lead_id) return false;
    if (showOnlyWaitingHuman && !(c.lead_id && waitingHumanLeadIds?.has(c.lead_id))) return false;
    // Filtrar por tab
    if (activeTab === "active" && c.archived_at) return false;
    if (activeTab === "archived" && !c.archived_at) return false;
    return (
      c.phone_number.includes(searchQuery) ||
      c.push_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.lead_name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const activeCount = contacts.filter((c) => !c.archived_at).length;
  const archivedCount = contacts.filter((c) => !!c.archived_at).length;

  return (
    <div className="flex flex-col h-full min-h-0 border-r border-border/60 bg-muted/20">
      <div className="p-3 border-b bg-background shrink-0">
        {instances && instances.length > 0 && onSelectInstance && selectedInstanceId != null && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Número / Inbox
              </p>
              {isAdmin && onOpenInstances && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOpenInstances}
                  className="h-6 gap-1 text-xs text-muted-foreground hover:text-foreground px-2"
                  title="Gerenciar instâncias WhatsApp"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Instâncias
                </Button>
              )}
            </div>
            <Select value={selectedInstanceId || ""} onValueChange={onSelectInstance}>
              <SelectTrigger className="h-9 w-full bg-background">
                <SelectValue placeholder="Escolha o número..." />
              </SelectTrigger>
              <SelectContent>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Inbox
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9 bg-background"
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-muted-foreground">
            Total: {filteredContacts.length}
          </p>
          <button
            type="button"
            onClick={onToggleShowOnlyWithLead}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors",
              showOnlyWithLead
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted"
            )}
            title={showOnlyWithLead ? "Mostrando apenas com lead" : "Clique para filtrar só com lead"}
          >
            <Filter className="w-3 h-3" />
            {showOnlyWithLead ? "Com lead" : "Todos"}
          </button>
          <button
            type="button"
            onClick={onToggleShowOnlyWaitingHuman}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors",
              showOnlyWaitingHuman
                ? "bg-amber-500/15 text-amber-600 font-medium"
                : "text-muted-foreground hover:bg-muted"
            )}
            title={showOnlyWaitingHuman ? "Mostrando apenas aguardando humano" : "Filtrar aguardando humano"}
          >
            <UserPlus className="w-3 h-3" />
            Humano
            {waitingHumanCount > 0 && (
              <span className="bg-amber-500 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {waitingHumanCount}
              </span>
            )}
          </button>
        </div>

        {/* Tabs: Ativas / Arquivadas */}
        <div className="flex mt-2 bg-muted rounded-md p-0.5">
          <button
            type="button"
            onClick={() => onTabChange("active")}
            className={cn(
              "flex-1 text-xs py-1.5 rounded-sm transition-colors font-medium",
              activeTab === "active"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Ativas ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => onTabChange("archived")}
            className={cn(
              "flex-1 text-xs py-1.5 rounded-sm transition-colors font-medium",
              activeTab === "archived"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Arquivadas ({archivedCount})
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            {activeTab === "archived" ? (
              <>
                <Archive className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">Nenhuma conversa arquivada</p>
              </>
            ) : (
              <>
                <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filteredContacts.map((contact) => {
              const displayName = contactDisplayName(contact);
              const isSelected = selectedPhone === contact.phone_number;
              return (
                <motion.div
                  key={contact.phone_number}
                  className={cn(
                    "w-full px-3 py-3 text-left transition-colors rounded-none border-l-2 cursor-pointer",
                    isSelected
                      ? "bg-primary/15 border-l-primary"
                      : contact.unread_count > 0
                        ? "bg-amber-50 dark:bg-amber-950/30 border-l-amber-500 hover:bg-amber-100 dark:hover:bg-amber-950/50"
                        : "hover:bg-muted/50 border-l-transparent"
                  )}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => onSelectContact(contact.phone_number)}
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
                          {/* Menu "..." ao lado do nome */}
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
                            <span className="text-[10px] font-normal text-muted-foreground/70 bg-muted px-1 py-0.5 rounded leading-none shrink-0">
                              Novo
                            </span>
                          )}
                          {/* Tag pills */}
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
                        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                          {formatContactTime(contact.last_message_time)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className="text-sm text-muted-foreground truncate flex-1 min-w-0 flex items-center gap-1.5">
                          {contact.last_message_direction === "outgoing" && (
                            <span className="text-primary shrink-0 font-medium" title="Você enviou">Você:</span>
                          )}
                          {contact.last_message_direction === "incoming" && (
                            <span className="text-muted-foreground shrink-0 italic" title="Contato enviou">Contato:</span>
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
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

/** Menu de contexto "..." para cada conversa */
function ContactContextMenu({
  contact,
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
}: {
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
}) {
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
          >
            <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
          {/* Submenu de tags */}
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
                          isActive && "bg-primary/10"
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

      {/* Dialog de confirmação de exclusão */}
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

// Edge Function exige Authorization; <audio src="..."> não envia header → 401. Resolvemos via fetch com token e blob.
const STREAM_MEDIA_PATH = "/functions/v1/stream-media";

// Componente de player de áudio - com fallback para carregar via blob quando a reprodução direta falhar (CORS/formato)
function AudioPlayer({ src, isOutgoing }: { src: string; isOutgoing: boolean }) {
  const [error, setError] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const conversionAttemptedRef = useRef(false);
  const retryWithNewBlobUrlRef = useRef(false);
  const rawBlobRef = useRef<Blob | null>(null);

  const isStreamMediaUrl = src.includes(STREAM_MEDIA_PATH);
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

  const isValidSrc = src && (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("blob:"));

  /**
   * Inferir tipo de áudio pela extensão da URL (funciona com stream-media?path=...file.mp3)
   */
  const inferAudioType = useCallback((url: string): string => {
    const ext = url.split(".").pop()?.split("?")[0]?.toLowerCase() || "";
    const typeMap: Record<string, string> = {
      mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg",
      webm: "audio/webm", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav",
    };
    return typeMap[ext] || "audio/ogg";
  }, []);

  /**
   * Garantir que o blob tenha um Content-Type de áudio correto.
   * Se o tipo for genérico (application/octet-stream ou vazio), infere pela URL.
   */
  const ensureBlobType = useCallback(async (blob: Blob, url: string): Promise<Blob> => {
    const type = (blob.type || "").toLowerCase();
    if (!type || type === "application/octet-stream") {
      const inferred = inferAudioType(url);
      return new Blob([await blob.arrayBuffer()], { type: inferred });
    }
    return blob;
  }, [inferAudioType]);

  // Etapa 1: Baixar o blob do stream-media com Authorization e servir com tipo correto
  // NÃO tenta converter — deixa o navegador reproduzir o formato original primeiro.
  useEffect(() => {
    if (!isStreamMediaUrl || !anonKey?.trim() || !src) return;
    let cancelled = false;
    conversionAttemptedRef.current = false;
    retryWithNewBlobUrlRef.current = false;
    rawBlobRef.current = null;
    setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setError(false);
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(src, {
          method: "GET",
          headers: { Authorization: `Bearer ${anonKey}` },
          credentials: "omit",
        });
        if (!res.ok) {
          let detail = "";
          try {
            const json = await res.json() as { error?: string; code?: string };
            detail = json?.code ? ` code=${json.code}` : "";
            if (json?.error) detail += ` ${json.error}`;
          } catch {
            detail = await res.text().then((t) => t.slice(0, 200)).catch(() => "");
          }
          console.error("[AudioPlayer] stream-media fetch failed", { status: res.status, detail, url: src?.slice(0, 80) });
          throw new Error(`HTTP ${res.status}${detail ? ` ${detail}` : ""}`);
        }
        let blob = await res.blob();
        if (cancelled) return;

        // Corrigir tipo genérico para que o navegador saiba decodificar; MP3 deve ser audio/mpeg
        blob = await ensureBlobType(blob, src);
        if (cancelled) return;
        if (blob.size === 0) {
          setLoading(false);
          setError(true);
          return;
        }
        rawBlobRef.current = blob;

        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error("[AudioPlayer] Fetch failed (network/CORS/auth)", { error: e instanceof Error ? e.message : e, url: src?.slice(0, 80) });
        setLoading(false);
        setError(true);
      }
    })();

    return () => {
      cancelled = true;
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [src, isStreamMediaUrl, anonKey, ensureBlobType]);

  // Resetar ao trocar de src (não-stream-media)
  useEffect(() => {
    if (isStreamMediaUrl) return;
    setError(false);
    setLoading(false);
    conversionAttemptedRef.current = false;
    retryWithNewBlobUrlRef.current = false;
    rawBlobRef.current = null;
    setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, [src, isStreamMediaUrl]);

  // Etapa 2 (fallback): Se o <audio> disparar erro, tentar novo blob URL (Safari) ou converter para MP3
  const handleError = useCallback(async () => {
    if (!isValidSrc) {
      setError(true);
      return;
    }

    const blob = rawBlobRef.current;
    const isMp3 = blob && (blob.type || "").toLowerCase().includes("mpeg") && blob.size > 0;

    // Se o blob já é MP3, tentar uma vez com novo blob URL (Safari às vezes falha no primeiro)
    if (isMp3 && !retryWithNewBlobUrlRef.current) {
      retryWithNewBlobUrlRef.current = true;
      try {
        const buf = await blob.arrayBuffer();
        const newBlob = new Blob([buf], { type: "audio/mpeg" });
        const newUrl = URL.createObjectURL(newBlob);
        setBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return newUrl;
        });
        if (audioRef.current) {
          audioRef.current.src = newUrl;
          audioRef.current.load();
        }
        return;
      } catch {
        // Segue para conversão
      }
    }

    if (conversionAttemptedRef.current) {
      setError(true);
      return;
    }
    conversionAttemptedRef.current = true;

    let blobToConvert = rawBlobRef.current;
    if (!blobToConvert) {
      setLoading(true);
      try {
        const headers: HeadersInit = {};
        if (isStreamMediaUrl && anonKey?.trim()) headers["Authorization"] = `Bearer ${anonKey}`;
        const res = await fetch(src, { mode: "cors", credentials: "omit", headers });
        if (!res.ok) {
          setLoading(false);
          setError(true);
          return;
        }
        blobToConvert = await ensureBlobType(await res.blob(), src);
      } catch {
        setLoading(false);
        setError(true);
        return;
      }
    }

    setLoading(true);
    try {
      const converted = await convertAudioBlobToMp3(blobToConvert);
      if (converted !== blobToConvert && converted.type.includes("mpeg")) {
        setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
        const url = URL.createObjectURL(converted);
        setBlobUrl(url);
        setLoading(false);
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.load();
        }
        return;
      }
    } catch {
      // Conversão falhou
    }

    setLoading(false);
    setError(true);
  }, [src, isValidSrc, isStreamMediaUrl, anonKey, ensureBlobType]);

  // Cleanup de blobUrl no unmount
  useEffect(() => {
    return () => {
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, []);

  if (!isValidSrc) {
    return (
      <div className="flex flex-col gap-1 min-w-[200px]">
        <p className="text-xs text-muted-foreground">URL do áudio inválida.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-1 min-w-[200px]">
        <p className="text-xs text-muted-foreground">Não foi possível reproduzir o áudio.</p>
      </div>
    );
  }

  if (loading || (isStreamMediaUrl && !blobUrl)) {
    return (
      <div className="flex items-center gap-2 min-w-[200px]">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground shrink-0" />
        <p className="text-xs text-muted-foreground">Carregando áudio…</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <audio
        ref={audioRef}
        controls
        controlsList="nodownload"
        src={blobUrl || src}
        className="h-10 max-w-[280px] flex-1"
        preload="auto"
        onError={handleError}
        playsInline
      />
    </div>
  );
}

// Componente para exibir imagem na mensagem
function MessageImage({
  src,
  onPreview,
}: {
  src: string;
  onPreview: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="w-48 h-32 bg-muted/50 rounded flex items-center justify-center">
        <FileImage className="w-8 h-8 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative cursor-pointer" onClick={onPreview}>
      {!loaded && (
        <div className="w-48 h-32 bg-muted/50 rounded flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <img
        src={src}
        alt="Imagem"
        className={cn(
          "max-w-[240px] max-h-[300px] rounded object-cover",
          !loaded && "hidden"
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  );
}

// Componente para exibir vídeo na mensagem
function MessageVideo({ src }: { src: string }) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="w-48 h-32 bg-muted/50 rounded flex flex-col items-center justify-center gap-2">
        <FileVideo className="w-8 h-8 text-muted-foreground" />
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <Download className="w-3 h-3" />
          Baixar vídeo
        </a>
      </div>
    );
  }

  return (
    <video
      src={src}
      controls
      className="max-w-[240px] max-h-[300px] rounded"
      onError={() => setError(true)}
    >
      Seu navegador não suporta vídeos.
    </video>
  );
}

// Componente para exibir documento na mensagem
function MessageDocument({
  src,
  fileName,
  isOutgoing,
}: {
  src: string;
  fileName?: string;
  isOutgoing: boolean;
}) {
  // Tentar extrair nome do arquivo da URL se não fornecido
  const displayName = fileName || src.split("/").pop() || "Documento";
  
  // Detectar tipo de arquivo pelo nome
  const getFileIcon = () => {
    const ext = displayName.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "pdf":
        return <FileText className="w-8 h-8" />;
      case "doc":
      case "docx":
        return <FileText className="w-8 h-8" />;
      case "xls":
      case "xlsx":
        return <FileText className="w-8 h-8" />;
      default:
        return <File className="w-8 h-8" />;
    }
  };

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg transition-colors min-w-[200px]",
        isOutgoing
          ? "bg-primary-foreground/10 hover:bg-primary-foreground/20"
          : "bg-primary/10 hover:bg-primary/20"
      )}
    >
      <div className={cn(
        "p-2 rounded",
        isOutgoing ? "bg-primary-foreground/20" : "bg-primary/20"
      )}>
        {getFileIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{displayName}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Download className="w-3 h-3" />
          Clique para baixar
        </p>
      </div>
    </a>
  );
}

function MessageBubble({
  message,
  onImagePreview,
}: {
  message: WhatsAppMessage;
  onImagePreview: (url: string) => void;
}) {
  const isOutgoing = message.direction === "outgoing";
  const isAudio = message.message_type === "audio" || message.message_type === "ptt";
  const isImage = message.message_type === "image";
  const isVideo = message.message_type === "video";
  const isDocument = message.message_type === "document";
  const isSticker = message.message_type === "sticker";
  const hasMedia = isAudio || isImage || isVideo || isDocument || isSticker;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-2", isOutgoing ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm border border-border/40",
          isOutgoing
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted/80 rounded-bl-md"
        )}
      >
        {/* Sender label for AI messages */}
        {isOutgoing && message.sent_by_ai && (
          <div className="flex items-center gap-1 mb-1">
            <Bot className="h-3 w-3 text-primary-foreground/70" />
            <span className="text-[10px] text-primary-foreground/70 font-medium">Copilot</span>
          </div>
        )}

        {/* Texto / Legenda */}
        {message.content && (
          <p className={cn(
            "text-sm whitespace-pre-wrap break-words",
            hasMedia && "mt-2"
          )}>
            {message.content}
          </p>
        )}

        {/* Áudio */}
        {isAudio && message.media_url && (
          <div>
            <AudioPlayer src={getAudioPlaybackUrl(message.media_url) ?? message.media_url} isOutgoing={isOutgoing} />
          </div>
        )}

        {/* Imagem */}
        {isImage && message.media_url && (
          <MessageImage
            src={message.media_url}
            onPreview={() => onImagePreview(message.media_url!)}
          />
        )}

        {/* Vídeo */}
        {isVideo && message.media_url && (
          <MessageVideo src={message.media_url} />
        )}

        {/* Documento */}
        {isDocument && message.media_url && (
          <MessageDocument
            src={message.media_url}
            isOutgoing={isOutgoing}
          />
        )}

        {/* Sticker */}
        {isSticker && message.media_url && (
          <img
            src={message.media_url}
            alt="Sticker"
            className="w-32 h-32 object-contain"
          />
        )}

        {/* Mensagem sem conteúdo e sem mídia */}
        {!message.content && !hasMedia && (
          <p className="text-sm italic text-muted-foreground">
            [Mensagem não suportada]
          </p>
        )}

        {/* Linha: data/hora e status */}
        <div
          className={cn(
            "flex items-center justify-end gap-2 mt-1.5 flex-wrap",
            isOutgoing ? "text-primary-foreground/80" : "text-muted-foreground"
          )}
        >
          <span className="text-xs">{formatMessageTime(message.timestamp)}</span>
          {isOutgoing && <MessageStatusIcon status={message.status} />}
        </div>
      </div>
    </motion.div>
  );
}

// Componente de gravação de áudio
function AudioRecorder({
  onRecorded,
  onCancel,
}: {
  onRecorded: (audioBlob: Blob) => void;
  onCancel: () => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const cancelledRef = useRef(false);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Tentar usar formato compatível com WhatsApp
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "audio/ogg;codecs=opus";
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = ""; // Usar padrão do browser
          }
        }
      }
      
      console.log("[AudioRecorder] Using mimeType:", mimeType || "default");
      
      const mediaRecorder = mimeType 
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());

        if (cancelledRef.current) {
          console.log("[AudioRecorder] Recording cancelled, discarding audio.");
          chunksRef.current = [];
          return;
        }

        const audioBlob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm"
        });
        console.log("[AudioRecorder] Recording finished:", {
          chunks: chunksRef.current.length,
          blobSize: audioBlob.size,
          mimeType: audioBlob.type,
        });
        onRecorded(audioBlob);
      };

      mediaRecorder.start(100); // Coletar dados a cada 100ms
      setIsRecording(true);
      
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error("[AudioRecorder] Error:", error);
      toast.error("Não foi possível acessar o microfone");
      onCancel();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const cancelRecording = () => {
    cancelledRef.current = true;
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    chunksRef.current = [];
    setIsRecording(false);
    setRecordingTime(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onCancel();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    startRecording();
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return (
    <div className="flex items-center gap-3 w-full bg-red-50 dark:bg-red-950/30 p-3 rounded-lg">
      <Button variant="ghost" size="icon" onClick={cancelRecording}>
        <X className="w-5 h-5 text-red-500" />
      </Button>
      
      <div className="flex-1 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-medium">{formatTime(recordingTime)}</span>
        <span className="text-sm text-muted-foreground">Gravando...</span>
      </div>

      <Button
        variant="default"
        size="icon"
        onClick={stopRecording}
        className="bg-green-500 hover:bg-green-600"
      >
        <Send className="w-4 h-4" />
      </Button>
    </div>
  );
}

// Modal de preview de imagem
function ImagePreviewModal({
  imageUrl,
  isOpen,
  onClose,
}: {
  imageUrl: string | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 text-white hover:text-gray-300"
        onClick={onClose}
      >
        <X className="w-8 h-8" />
      </button>
      <img
        src={imageUrl}
        alt="Preview"
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function ChatWindow({
  phoneNumber,
  onBack,
  instanceName,
  instanceId,
  onOpenLeadModal,
  hasLead,
  leadId,
  leadAiDisabled,
  selectedContact,
  selectedLeadName,
}: {
  phoneNumber: string;
  onBack: () => void;
  instanceName: string;
  instanceId: string;
  onOpenLeadModal: () => void;
  hasLead: boolean;
  leadId?: string;
  leadAiDisabled?: boolean;
  selectedContact: ChatContact | undefined;
  selectedLeadName?: string | null;
}) {
  const [newMessage, setNewMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imageCaption, setImageCaption] = useState("");
  const toggleAIMutation = useToggleLeadAI();
  const toggleConversationAIMutation = useToggleConversationAI();
  // Estado local otimista para feedback visual imediato
  const [optimisticAiDisabled, setOptimisticAiDisabled] = useState<boolean | null>(null);

  // Usar estado otimista se disponível, senão usar o valor da prop
  const currentAiDisabled = optimisticAiDisabled !== null ? optimisticAiDisabled : (leadAiDisabled ?? false);

  // Limpar estado otimista ao trocar de conversa (leadId muda)
  useEffect(() => {
    setOptimisticAiDisabled(null);
  }, [leadId]);

  // Quando a prop leadAiDisabled refletir o valor otimista, limpar o estado otimista
  useEffect(() => {
    if (optimisticAiDisabled !== null && leadAiDisabled === optimisticAiDisabled) {
      setOptimisticAiDisabled(null);
    }
  }, [leadAiDisabled, optimisticAiDisabled]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Pré-carregar lamejs para conversão WebM→MP3 na gravação (evita enviar áudio em formato que Safari não reproduz)
  useEffect(() => {
    preloadLamejs();
  }, []);

  const { data: messages = [], isLoading } = useWhatsAppMessages(phoneNumber, instanceId);

  // Fetch conversation state for transfer badge
  const { data: conversationState } = useQuery({
    queryKey: ['conversation-state', leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const { data } = await supabase
        .from('conversations')
        .select('state')
        .eq('lead_id', leadId)
        .maybeSingle();
      return data?.state ?? null;
    },
    enabled: !!leadId,
  });

  const isWaitingHuman = conversationState === 'WAITING_HUMAN';

  // Fetch transfer events for inline timeline cards
  const { data: transferEvents = [] } = useQuery({
    queryKey: ['transfer-events', leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data } = await supabase
        .from('lead_history')
        .select('id, metadata, created_at')
        .eq('lead_id', leadId)
        .eq('action', 'ai_toggled')
        .not('metadata', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);
      return (data ?? [])
        .filter((e: any) => (e.metadata as Record<string, unknown>)?.reason)
        .map((e: any) => ({
          id: e.id,
          type: 'transfer_event' as const,
          reason: ((e.metadata as Record<string, unknown>)?.reason as string) || '',
          timestamp: e.created_at,
        }));
    },
    enabled: !!leadId,
  });

  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();
  const { canReply: canReplyOnThisNumber } = useCanReplyOnInstanceByName(instanceName);

  // SZ.chat transfer-back: check if this contact has an active SZ.chat session
  const { data: teamMemberCW } = useCurrentTeamMember();
  const organizationIdCW = teamMemberCW?.organization_id ?? null;
  const { data: szChatSession } = useActiveSzChatSession(phoneNumber, organizationIdCW);
  const transferToSzChat = useTransferToSzChatDepartment();

  // Ativar realtime
  useWhatsAppMessagesRealtime(phoneNumber);

  // Auto-scroll para última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !instanceName) return;

    try {
      await sendMessage.mutateAsync({
        phoneNumber,
        message: newMessage.trim(),
        instanceName,
        instanceId,
      });
      setNewMessage("");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar mensagem");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Enviar imagem
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast.error("Selecione apenas imagens");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Imagem muito grande (máximo 10MB)");
        return;
      }
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSendImage = async () => {
    if (!selectedImage || !instanceName) return;

    try {
      // Converter arquivo para base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(selectedImage);
      });

      console.log("[Image] Sending image:", {
        fileName: selectedImage.name,
        fileType: selectedImage.type,
        fileSize: selectedImage.size,
        base64Length: base64.length,
      });

      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType: "image",
        media: base64,
        caption: imageCaption || undefined,
        fileName: selectedImage.name,
        mimetype: selectedImage.type,
      });

      setSelectedImage(null);
      setImagePreview(null);
      setImageCaption("");
      toast.success("Imagem enviada!");
    } catch (error: any) {
      console.error("[Image] Error sending:", error);
      toast.error(error.message || "Erro ao enviar imagem");
    }
  };

  // Enviar áudio: só envia em MP3 para reprodução em todos os navegadores (Safari não reproduz WebM/OGG)
  const handleAudioRecorded = async (audioBlob: Blob) => {
    setIsRecording(false);

    try {
      const blobToSend = await convertAudioBlobToMp3(audioBlob);
      const isMp3 = (blobToSend.type || "").toLowerCase().includes("mpeg") || (blobToSend.type || "").toLowerCase().includes("mp3");
      if (!isMp3 || blobToSend.size === 0) {
        toast.error("Não foi possível converter o áudio para MP3. Tente gravar novamente.");
        return;
      }

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blobToSend);
      });

      await sendMedia.mutateAsync({
        phoneNumber,
        instanceName,
        instanceId,
        mediaType: "audio",
        media: base64,
        mimetype: "audio/mpeg",
      });

      toast.success("Áudio enviado!");
    } catch (error: any) {
      console.error("[Audio] Error sending:", error);
      toast.error(error.message || "Erro ao enviar áudio");
    }
  };

  // Nome do contato: prioriza push_name (nome real do WhatsApp) — consistente com contactDisplayName na lista lateral
  const contactNameRaw =
    selectedContact?.push_name ??
    messages.find((m) => m.push_name)?.push_name ??
    selectedLeadName ??
    selectedContact?.lead_name ??
    phoneNumber;
  const contactName = (contactNameRaw && String(contactNameRaw).trim()) ? String(contactNameRaw).trim() : (phoneNumber || "?");

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header - Clicável para abrir painel do lead */}
      <div className="flex items-center gap-3 p-3 border-b border-border/60 bg-background shrink-0">
        <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        
        {/* Área clicável do contato */}
        <div
          role="button"
          tabIndex={0}
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer hover:bg-muted/50 -m-2 p-2 rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenLeadModal(); }}
          onPointerDown={(e) => { e.stopPropagation(); onOpenLeadModal(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenLeadModal(); } }}
        >
          <div className="relative shrink-0">
            <Avatar className="w-10 h-10 border-2 border-background shadow-sm">
              <AvatarFallback className={cn(
                "font-medium text-primary",
                hasLead ? "bg-primary/15 text-primary" : "bg-primary/10"
              )}>
                {(contactName.charAt(0) || "?").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <ChannelBadge channel="whatsapp" size={16} overlay />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate text-foreground">{contactName}</h3>
              {!hasLead && (
                <Badge variant="secondary" className="text-xs shrink-0 text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40 border-0">
                  Sem lead
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-1 truncate">
              <Phone className="w-3 h-3 shrink-0" />
              {phoneNumber}
            </p>
          </div>
          <UserCircle className="w-5 h-5 text-muted-foreground shrink-0" />
        </div>

        {/* Botão para ver ou criar lead */}
        <Button
          type="button"
          variant={hasLead ? "ghost" : "outline"}
          size="sm"
          className={cn("shrink-0", !hasLead && "border-primary text-primary hover:bg-primary/10")}
          onClick={(e) => { e.stopPropagation(); onOpenLeadModal(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title={hasLead ? "Ver dados do lead e pipeline" : "Criar lead para este contato"}
        >
          {hasLead ? (
            <>
              <UserCircle className="w-4 h-4 mr-1.5" />
              Ver lead
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-1.5" />
              Criar Lead
            </>
          )}
        </Button>

        {/* AI Toggle - sempre visível em qualquer conversa (com ou sem lead/card) */}
        <motion.div
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors duration-200",
            currentAiDisabled ? "bg-muted/50" : "bg-primary/10"
          )}
          title="Ativar ou desativar o Copilot nesta conversa"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <motion.div
            animate={{
              scale: (toggleAIMutation.isPending || toggleConversationAIMutation.isPending) ? [1, 1.2, 1] : 1,
              rotate: (toggleAIMutation.isPending || toggleConversationAIMutation.isPending) ? [0, 10, -10, 0] : 0,
            }}
            transition={{
              duration: 0.5,
              repeat: (toggleAIMutation.isPending || toggleConversationAIMutation.isPending) ? Infinity : 0,
            }}
          >
            <Bot className={cn(
              "w-4 h-4 transition-colors duration-200",
              currentAiDisabled ? "text-muted-foreground" : "text-primary"
            )} />
          </motion.div>
          <motion.span
            className="text-xs text-muted-foreground hidden sm:inline"
            animate={{
              opacity: currentAiDisabled ? 0.5 : 1,
            }}
            transition={{ duration: 0.2 }}
          >
            IA
          </motion.span>
          <div onClick={(e) => e.stopPropagation()}>
            <motion.div
              animate={{
                scale: (toggleAIMutation.isPending || toggleConversationAIMutation.isPending) ? 0.95 : 1,
              }}
              transition={{ duration: 0.15 }}
            >
              <Switch
                checked={!currentAiDisabled}
                onCheckedChange={(checked) => {
                  setOptimisticAiDisabled(!checked);

                  if (leadId) {
                    // Lead existe: usar toggle direto por leadId
                    toggleAIMutation.mutate(
                      { leadId, disabled: !checked },
                      {
                        onSuccess: () => {
                          toast.success(checked ? "IA ativada" : "IA desativada");
                          // Não limpar optimistic aqui. O onSuccess do useLeads.ts
                          // já atualizou o cache diretamente. O useEffect sync
                          // limpa o optimistic quando leadAiDisabled prop atualizar.
                        },
                        onError: (err: any) => {
                          setOptimisticAiDisabled(null);
                          const msg = err?.message || "Erro desconhecido";
                          toast.error(`Erro ao alterar Copilot: ${msg}`);
                          console.error("[toggleAI] Error:", err);
                        },
                      }
                    );
                  } else {
                    // Sem lead: criar shadow lead + toggle por telefone
                    toggleConversationAIMutation.mutate(
                      { phone: phoneNumber, disabled: !checked },
                      {
                        onSuccess: () => {
                          toast.success(checked ? "IA ativada" : "IA desativada");
                          // Não limpar optimistic aqui. O onSuccess do useLeads.ts
                          // já atualizou o cache diretamente. O useEffect sync
                          // limpa o optimistic quando leadAiDisabled prop atualizar.
                        },
                        onError: (err: any) => {
                          setOptimisticAiDisabled(null);
                          const msg = err?.message || "Erro desconhecido";
                          toast.error(`Erro ao alterar Copilot: ${msg}`);
                          console.error("[toggleAI] Error:", err);
                        },
                      }
                    );
                  }
                }}
                disabled={toggleAIMutation.isPending || toggleConversationAIMutation.isPending}
              />
            </motion.div>
          </div>
        </motion.div>

        {/* Transfer / AI state badge */}
        {hasLead && leadId && isWaitingHuman && (
          <Badge variant="outline" className="border-amber-400 text-amber-600 gap-1.5 text-xs">
            <UserPlus className="h-3 w-3" />
            Aguardando humano
          </Badge>
        )}
        {currentAiDisabled && !isWaitingHuman && (
          <Badge variant="outline" className="text-muted-foreground gap-1.5 text-xs">
            IA desativada
          </Badge>
        )}

        {/* SZ.chat transfer-back button: only visible when there is an active SZ.chat session */}
        {szChatSession && Object.keys(szChatSession.team_mappings).length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5 text-xs"
                disabled={transferToSzChat.isPending}
              >
                {transferToSzChat.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                )}
                Transferir setor
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {Object.entries(szChatSession.team_mappings).map(([teamName, teamId]) => (
                <DropdownMenuItem
                  key={teamId}
                  onClick={() => {
                    if (!organizationIdCW) return;
                    transferToSzChat.mutate(
                      {
                        organizationId: organizationIdCW,
                        sessionId: szChatSession.sz_chat_session_id,
                        targetTeamName: teamName,
                        targetTeamId: teamId,
                      },
                      {
                        onSuccess: () => {
                          toast.success(`Conversa transferida para ${teamName}`);
                        },
                        onError: (err) => {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : "Erro ao transferir conversa"
                          );
                        },
                      }
                    );
                  }}
                >
                  {teamName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Área de mensagens: altura limitada com scroll interno; boundary evita "fewer hooks" ao isolar erros */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1 h-full">
          <div className="p-4 min-h-full">
            <MessagesAreaErrorBoundary>
            {isLoading ? (
              <div className="flex items-center justify-center min-h-[200px]">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[200px] text-center">
                <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">
                  Nenhuma mensagem ainda. Envie uma mensagem para iniciar a conversa.
                </p>
              </div>
            ) : (
              <div className="space-y-1 pb-4">
                {(() => {
                  // Merge messages + transfer events, sorted by timestamp
                  const timeline = [
                    ...messages.map(m => ({ ...m, _type: 'message' as const })),
                    ...transferEvents.map(e => ({ ...e, _type: 'transfer' as const })),
                  ].sort((a, b) => {
                    const timeA = new Date(a.timestamp).getTime();
                    const timeB = new Date(b.timestamp).getTime();
                    return timeA - timeB;
                  });

                  let lastDate = "";
                  return timeline.map((item, index) => {
                    // Transfer event card
                    if (item._type === 'transfer') {
                      return (
                        <div key={`transfer-${item.id}`} className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/20 border-l-2 border-amber-400 mx-4 my-2 rounded-r">
                          <UserPlus className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Transferido para humano</p>
                            {item.reason && (
                              <p className="text-xs text-amber-700 dark:text-amber-300">{item.reason}</p>
                            )}
                            <p className="text-xs text-amber-500 mt-0.5">
                              {new Date(item.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    // Normal message (preserve existing date separator + MessageBubble logic)
                    const message = item;
                    const ts = message?.timestamp;
                    const date = ts ? new Date(ts) : new Date();
                    const validDate = !Number.isNaN(date.getTime());
                    const msgDate = validDate ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "";
                    const showDateSeparator = msgDate !== lastDate;
                    if (showDateSeparator) lastDate = msgDate;
                    const dateLabel = validDate
                      ? isToday(date)
                        ? "Hoje"
                        : isYesterday(date)
                          ? "Ontem"
                          : format(date, "dd/MM/yyyy", { locale: ptBR })
                      : "";
                    const safeKey = message?.id || `msg-${index}-${ts || index}`;
                    return (
                      <div key={safeKey}>
                        {showDateSeparator && (
                          <div className="flex justify-center py-3">
                            <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                              {dateLabel}
                            </span>
                          </div>
                        )}
                        <MessageBubble
                          message={message}
                          onImagePreview={setPreviewImageUrl}
                        />
                      </div>
                    );
                  });
                })()}
                <div ref={messagesEndRef} />
              </div>
            )}
            </MessagesAreaErrorBoundary>
          </div>
        </ScrollArea>
      </div>

      {/* Image Preview (para envio) - fixo acima do input */}
      {selectedImage && imagePreview && (
        <div className="p-4 border-t bg-muted/30 shrink-0">
          <div className="flex items-start gap-3">
            <div className="relative">
              <img
                src={imagePreview}
                alt="Preview"
                className="w-20 h-20 object-cover rounded-lg"
              />
              <button
                onClick={() => {
                  setSelectedImage(null);
                  setImagePreview(null);
                  setImageCaption("");
                }}
                className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 space-y-2">
              <Input
                placeholder="Adicionar legenda (opcional)..."
                value={imageCaption}
                onChange={(e) => setImageCaption(e.target.value)}
              />
              <Button
                onClick={handleSendImage}
                disabled={sendMedia.isPending}
                className="w-full"
              >
                {sendMedia.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Enviar Imagem
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Input - sempre visível no rodapé (shrink-0) */}
      <div className="p-3 border-t border-border/60 bg-background shrink-0">
        {!canReplyOnThisNumber ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              Apenas os vendedores selecionados para este número podem responder no chat. Peça ao admin para incluir você na configuração da instância.
            </span>
          </div>
        ) : isRecording ? (
          <AudioRecorder
            onRecorded={handleAudioRecorded}
            onCancel={() => setIsRecording(false)}
          />
        ) : (
          <div className="flex items-center gap-2">
            {/* Input de arquivo oculto */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />
            
            {/* Botão de imagem */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendMessage.isPending || sendMedia.isPending}
            >
              <ImageIcon className="w-5 h-5 text-muted-foreground" />
            </Button>

            {/* Input de texto */}
            <Input
              placeholder={`Bate-papo com ${contactName}: escreva uma mensagem...`}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sendMessage.isPending || sendMedia.isPending}
              className="flex-1 rounded-full border-border/60 bg-muted/30 focus:bg-background"
            />

            {/* Botão de enviar ou gravar */}
            {newMessage.trim() ? (
              <Button
                onClick={handleSend}
                disabled={sendMessage.isPending}
                size="icon"
              >
                {sendMessage.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsRecording(true)}
                disabled={sendMedia.isPending}
              >
                <Mic className="w-5 h-5 text-muted-foreground" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Modal de preview de imagem */}
      <ImagePreviewModal
        imageUrl={previewImageUrl}
        isOpen={!!previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />
    </div>
  );
}

const LAST_SEEN_KEY = "whatsapp_last_seen_";

function normalizePhoneForStorage(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10) || phone;
}

/** Normaliza telefone para URL/API: só dígitos. */
function normalizePhoneForParam(phone: string): string {
  return phone.replace(/\D/g, "") || phone;
}

const CHAT_SELECTED_INSTANCE_KEY = "whatsapp_chat_selected_instance_id";

export function WhatsAppChat() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyWithLead, setShowOnlyWithLead] = useState(false);
  const [showOnlyWaitingHuman, setShowOnlyWaitingHuman] = useState(false);
  const [isLeadPanelOpen, setIsLeadPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");
  const [isInstancesModalOpen, setIsInstancesModalOpen] = useState(false);

  const { data: instances = [], isLoading: instancesLoading } = useWhatsAppInstancesForUser();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(() => {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage.getItem(CHAT_SELECTED_INSTANCE_KEY);
  });

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId) ?? instances[0] ?? null;
  const effectiveInstanceId = selectedInstance?.id ?? selectedInstanceId;

  const { data: contacts = [], isLoading: contactsLoading } = useWhatsAppContacts(effectiveInstanceId);
  const { data: selectedLead, isLoading: selectedLeadLoading } = useLeadByPhone(selectedPhone);
  const createLeadFromWhatsApp = useCreateLeadFromWhatsApp();

  // Hooks para archive/delete/tags
  const { isAdmin } = useIsAdmin();
  const { data: teamMember } = useCurrentTeamMember();

  const { data: waitingHumanLeadIds } = useQuery({
    queryKey: ['waiting-human-leads', teamMember?.organization_id],
    queryFn: async () => {
      if (!teamMember?.organization_id) return new Set<string>();
      const { data } = await supabase
        .from('conversations')
        .select('lead_id')
        .eq('organization_id', teamMember.organization_id)
        .eq('state', 'WAITING_HUMAN');
      return new Set((data ?? []).map((c: any) => c.lead_id as string));
    },
    enabled: !!teamMember?.organization_id,
    refetchInterval: 30000,
  });

  const waitingHumanCount = waitingHumanLeadIds?.size ?? 0;

  const { data: allTags = [] } = useTags();
  const archiveConversation = useArchiveConversation();
  const unarchiveConversation = useUnarchiveConversation();
  const deleteConversation = useDeleteConversation();
  const addConversationTag = useAddConversationTag();
  const removeConversationTag = useRemoveConversationTag();

  const handleArchive = useCallback((phoneNumber: string) => {
    if (!effectiveInstanceId) return;
    archiveConversation.mutate(
      { instanceId: effectiveInstanceId, phoneNumber },
      {
        onSuccess: () => toast.success("Conversa arquivada"),
        onError: () => toast.error("Erro ao arquivar conversa"),
      }
    );
  }, [effectiveInstanceId, archiveConversation]);

  const handleUnarchive = useCallback((conversationId: string) => {
    unarchiveConversation.mutate(
      { conversationId },
      {
        onSuccess: () => toast.success("Conversa desarquivada"),
        onError: () => toast.error("Erro ao desarquivar conversa"),
      }
    );
  }, [unarchiveConversation]);

  const handleDelete = useCallback((phoneNumber: string) => {
    if (!effectiveInstanceId || !teamMember?.organization_id) return;
    deleteConversation.mutate(
      {
        instanceId: effectiveInstanceId,
        phoneNumber,
        organizationId: teamMember.organization_id,
      },
      {
        onSuccess: () => {
          toast.success("Conversa excluída");
          if (selectedPhone === phoneNumber) setSelectedPhone(null);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao excluir conversa"),
      }
    );
  }, [effectiveInstanceId, teamMember?.organization_id, deleteConversation, selectedPhone]);

  const handleAddTag = useCallback((phoneNumber: string, tagId: string) => {
    if (!effectiveInstanceId) return;
    addConversationTag.mutate(
      { instanceId: effectiveInstanceId, phoneNumber, tagId },
      { onError: () => toast.error("Erro ao adicionar tag") }
    );
  }, [effectiveInstanceId, addConversationTag]);

  const handleRemoveTag = useCallback((conversationId: string, tagId: string) => {
    removeConversationTag.mutate(
      { conversationId, tagId },
      { onError: () => toast.error("Erro ao remover tag") }
    );
  }, [removeConversationTag]);

  // Persistir e sincronizar instância selecionada
  useEffect(() => {
    if (effectiveInstanceId && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(CHAT_SELECTED_INSTANCE_KEY, effectiveInstanceId);
    }
  }, [effectiveInstanceId]);

  useEffect(() => {
    if (instances.length > 0 && !effectiveInstanceId) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, effectiveInstanceId]);

  // Abrir conversa pelo parâmetro ?phone= (pipes, campanhas, etc.)
  useEffect(() => {
    const phoneParam = searchParams.get("phone");
    if (phoneParam) {
      const normalized = normalizePhoneForParam(phoneParam);
      if (normalized) {
        setSelectedPhone(normalized);
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  // Ativar realtime para lista de contatos
  useWhatsAppMessagesRealtime(null);

  // Ao abrir uma conversa, marcar como lida (atualizar last_seen e invalidar lista)
  useEffect(() => {
    if (!selectedPhone) return;
    const key = LAST_SEEN_KEY + normalizePhoneForStorage(selectedPhone);
    localStorage.setItem(key, new Date().toISOString());
    queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
  }, [selectedPhone, queryClient]);

  // Pegar pushName do contato selecionado
  const selectedContact = contacts.find((c) => c.phone_number === selectedPhone);

  // Lead creation is now manual — no auto-creation when selecting a conversation

  if (instancesLoading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center p-8">
        <AlertCircle className="w-16 h-16 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium mb-2">Você não está vinculado a nenhum número</h3>
        <p className="text-muted-foreground mb-4 max-w-md">
          Nenhuma conversa será exibida até que um administrador vincule você a um número/inbox.
          Peça ao administrador para incluir você na configuração da instância desejada.
        </p>
        {isAdmin ? (
          <Button onClick={() => setIsInstancesModalOpen(true)} className="gap-2">
            <Settings className="w-4 h-4" />
            Instâncias
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <a href="/configuracoes">Ir para Configurações</a>
          </Button>
        )}
        <Dialog open={isInstancesModalOpen} onOpenChange={setIsInstancesModalOpen}>
          <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Instâncias WhatsApp
              </DialogTitle>
              <DialogDescription>
                Gerencie suas conexões WhatsApp via Evolution API
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
              <div className="pr-1 pb-4">
                <WhatsAppSettings />
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 min-h-0 h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] rounded-lg border bg-background overflow-hidden">
        {/* Contact List - altura limitada com scroll interno */}
        <div
          className={cn(
            "w-full md:w-80 lg:w-96 flex-shrink-0 min-h-0 flex flex-col overflow-hidden",
            selectedPhone && "hidden md:flex md:flex-col"
          )}
        >
          <ContactList
            contacts={contacts}
            selectedPhone={selectedPhone}
            onSelectContact={setSelectedPhone}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            isLoading={contactsLoading}
            instances={instances}
            selectedInstanceId={effectiveInstanceId}
            onSelectInstance={setSelectedInstanceId}
            showOnlyWithLead={showOnlyWithLead}
            onToggleShowOnlyWithLead={() => setShowOnlyWithLead((v) => !v)}
            showOnlyWaitingHuman={showOnlyWaitingHuman}
            onToggleShowOnlyWaitingHuman={() => setShowOnlyWaitingHuman(!showOnlyWaitingHuman)}
            waitingHumanCount={waitingHumanCount}
            waitingHumanLeadIds={waitingHumanLeadIds}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onArchive={handleArchive}
            onUnarchive={handleUnarchive}
            onDelete={handleDelete}
            isAdmin={isAdmin}
            instanceId={effectiveInstanceId ?? null}
            organizationId={teamMember?.organization_id ?? null}
            allTags={allTags}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onOpenInstances={isAdmin ? () => setIsInstancesModalOpen(true) : undefined}
          />
        </div>

        {/* Chat Window - min-h-0 para scroll interno na área de mensagens */}
        <div className={cn("flex-1 min-h-0 overflow-hidden flex flex-col", !selectedPhone && "hidden md:flex")}>
          {selectedPhone && selectedInstance ? (
            <ChatWindow
              phoneNumber={selectedPhone}
              onBack={() => setSelectedPhone(null)}
              instanceName={selectedInstance.instance_name}
              instanceId={selectedInstance.id}
              onOpenLeadModal={() => {
                if (import.meta.env.DEV) console.log("[Chat] Abrindo painel do lead");
                setIsLeadPanelOpen(true);
              }}
              hasLead={!!(selectedLead || selectedContact?.lead_id)}
              leadId={selectedLead?.id ?? selectedContact?.lead_id ?? undefined}
              leadAiDisabled={selectedLead?.ai_disabled}
              selectedContact={selectedContact}
              selectedLeadName={selectedLead?.name}
            />
          ) : selectedPhone ? null : (
            <div className="flex flex-col items-center justify-center h-full w-full text-center p-8">
              <MessageSquare className="w-16 h-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">Selecione uma conversa</h3>
              <p className="text-muted-foreground">
                Escolha um contato na lista para ver as mensagens
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal de Instâncias WhatsApp */}
      {isAdmin && (
        <Dialog open={isInstancesModalOpen} onOpenChange={setIsInstancesModalOpen}>
          <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Instâncias WhatsApp
              </DialogTitle>
              <DialogDescription>
                Gerencie suas conexões WhatsApp via Evolution API
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
              <div className="pr-1 pb-4">
                <WhatsAppSettings />
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}

      {/* Wizard/Modal do lead (Informações → Pipeline → Campanhas) */}
      {selectedPhone && (
        <Dialog open={isLeadPanelOpen} onOpenChange={setIsLeadPanelOpen}>
          <DialogContent
            className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0"
            aria-describedby="lead-wizard-desc"
          >
            <DialogHeader className="sr-only">
              <DialogTitle>Lead — Informações, Pipeline e Campanhas</DialogTitle>
              <DialogDescription id="lead-wizard-desc">
                Dados do contato, etapa no pipe de qualificação e campanhas.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-6 pt-14">
              <LeadDetailContent
                phoneNumber={selectedPhone}
                pushName={selectedContact?.push_name}
                onClose={() => setIsLeadPanelOpen(false)}
                showHeader={true}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
