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
  Link2,
} from "lucide-react";
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
import type { ChatContact } from "@/modules/communication/hooks/useWhatsAppChat";
import {
  contactAvatarSeed,
  contactKey,
  contactLabel,
  type InboxContact,
} from "@/modules/communication/hooks/chat/types";
import { ChannelBadge } from "../ChannelBadge";
import { instanceColor } from "../bubble/utils/instanceColor";
import { getAvatarGradient } from "./avatarGradient";
import type { CaixaDaLinha } from "@/modules/communication/lib/caixaUnificada";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Rótulo da linha. Delega para `contactLabel`, que é o único lugar que sabe
 * nomear conversa de cada canal — este export continua existindo porque a lista
 * e a linha do mobile já o importam por este nome.
 */
export function contactDisplayName(c: InboxContact): string {
  return contactLabel(c);
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
  /**
   * A CAIXA vai junto: `whatsapp_conversations` é por (instância, telefone), e
   * no modo unificado a linha clicada pode ser de uma caixa que não é a da
   * conversa aberta. Sem ela, arquivar a linha da Técnica arquivaria a conversa
   * homônima do Comercial.
   */
  onArchive: (phone: string, instanceId?: string | null) => void;
  onUnarchive: (conversationId: string) => void;
  onDelete: (phone: string, instanceId?: string | null) => void;
  onAddTag: (phone: string, tagId: string, instanceId?: string | null) => void;
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
                            onAddTag(contact.phone_number, tag.id, contact.instance_id);
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
            <DropdownMenuItem
              onClick={() => onArchive(contact.phone_number, contact.instance_id)}
            >
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
                onDelete(contact.phone_number, contact.instance_id);
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
  contact: InboxContact;
  isSelected: boolean;
  /** Recebe `contactKey(contact)` — telefone no WhatsApp, `conversation_key` no social. */
  onSelect: (key: string) => void;
  waitingHumanLeadIds?: Set<string>;
  activeTab: "active" | "archived";
  isAdmin: boolean;
  instanceId: string | null;
  organizationId: string | null;
  allTags: { id: string; name: string; color: string }[];
  onArchive: (phone: string, instanceId?: string | null) => void;
  onUnarchive: (conversationId: string) => void;
  onDelete: (phone: string, instanceId?: string | null) => void;
  onAddTag: (phone: string, tagId: string, instanceId?: string | null) => void;
  onRemoveTag: (conversationId: string, tagId: string) => void;
  /** Rótulo da etapa atual do lead (primeiro funil), resolvido pela lista. */
  stageLabel?: string | null;
  /**
   * A CAIXA de onde esta conversa veio.
   *
   * OPCIONAL, e ausente é o caminho de hoje: com uma caixa marcada, dizer de
   * qual caixa a linha veio é repetir o que o seletor já diz três centímetros
   * acima. São 42 das 62 organizações com um número só — elas não podem ganhar
   * ruído por causa de uma capacidade que não usam.
   */
  caixa?: CaixaDaLinha;
  /**
   * As OUTRAS caixas em que este mesmo interlocutor tem conversa na tela.
   *
   * É o "fio" da decisão 1 do grill: duas linhas do mesmo contato não são
   * duplicata da tela, são duas Conversas do Lead. Sem essa nota a lista parece
   * ter repetido a pessoa — e a leitura de "a tela bugou" é pior que a de "ele
   * fala nos dois números".
   */
  tambemEm?: readonly CaixaDaLinha[];
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
  stageLabel,
  caixa,
  tambemEm,
}: ConversationListItemProps) {
  const displayName = contactDisplayName(contact);
  const avatarGradient = getAvatarGradient(contactAvatarSeed(contact));
  const key = contactKey(contact);
  // Ações de conversa (arquivar/excluir/etiquetar) vivem em
  // `whatsapp_conversations`. Não existe tabela equivalente para canal social,
  // então o menu não é renderizado — melhor ausente do que presente e inerte.
  const isWhatsApp = contact.channel === "whatsapp";

  return (
    <motion.div
      key={key}
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
      aria-label={`Conversa com ${displayName}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(key);
        }
      }}
      className={cn(
        "w-full px-3 py-3 text-left transition-colors rounded-none border-l-2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-10 focus-visible:relative",
        isSelected
          ? "bg-primary/[0.08] border-l-primary"
          : contact.unread_count > 0
            ? "bg-primary/[0.04] border-l-primary/40 hover:bg-primary/[0.07]"
            : "hover:bg-muted/50 border-l-transparent",
      )}
      whileTap={{ scale: 0.99 }}
      onClick={() => onSelect(key)}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {!isWhatsApp && contact.avatar_url ? (
            <img
              src={contact.avatar_url}
              alt=""
              className="w-11 h-11 rounded-full border-2 border-background shadow-sm object-cover"
            />
          ) : (
            <div
              className={cn(
                "w-11 h-11 rounded-full border-2 border-background shadow-sm flex items-center justify-center font-semibold text-sm select-none",
                avatarGradient.ink ? "text-[#1c1c1c]" : "text-white",
              )}
              style={{ background: avatarGradient.background }}
              aria-hidden
            >
              {(displayName.replace("@", "").charAt(0) || "?").toUpperCase()}
            </div>
          )}
          {/* O selo deixa de ser chumbado: é ele que faz a segunda caixa ser
              lida como Instagram, e não como "mais um número". */}
          <ChannelBadge channel={contact.channel} size={18} overlay />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="font-semibold text-foreground truncate text-sm flex items-center gap-1">
              <span className="truncate">{displayName}</span>
              {isWhatsApp && (
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
              )}
              {/* "Sem lead ainda" é informação onde o vínculo é possível — e
                  desde que a conversa de Instagram pode virar lead pelo painel,
                  isso passou a valer para os dois canais. O ponto some assim que
                  alguém vincula, nos dois. */}
              {!contact.lead_id && (
                <span className="w-2 h-2 rounded-full bg-primary/60 shrink-0" title="Novo" />
              )}
              {/* No WhatsApp o nome do lead JÁ é o título da linha
                  (`contactDisplayName`). No Instagram o título é o @handle —
                  que é o que a pessoa vê no app — então o lead vinculado só
                  aparece se ganhar espaço próprio. */}
              {!isWhatsApp && contact.lead_name && (
                <span
                  className="text-[10px] leading-none px-1.5 py-0.5 rounded shrink-0 max-w-[104px] truncate bg-muted text-muted-foreground/90 whitespace-nowrap"
                  title={`Lead: ${contact.lead_name}`}
                >
                  {contact.lead_name}
                </span>
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
              {/* De qual caixa esta conversa corre. Vive na linha de metadados,
                  e não ao lado do nome: o nome é o que a pessoa procura ao
                  varrer a lista, e um selo disputando esse espaço rouba a
                  varredura. A cor é a MESMA que a bolha de chat dá ao número —
                  duas derivações dariam duas cores para a mesma caixa. */}
              {caixa && (
                <span
                  className="flex items-center gap-1 shrink-0 max-w-[132px]"
                  title={`Caixa: ${caixa.nome}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: instanceColor(caixa.id) }}
                    aria-hidden
                  />
                  <span className="text-[10px] leading-none truncate text-muted-foreground/90">
                    {caixa.nome}
                  </span>
                </span>
              )}
              {/* O FIO. Texto, e não só um ícone: cor e forma sozinhas não dizem
                  QUAL é a outra caixa, e é justamente isso que decide se a
                  pessoa responde aqui ou lá. Fica na mesma linha e trunca —
                  altura de linha variável quebra a lista virtualizada. */}
              {tambemEm && tambemEm.length > 0 && (
                <span
                  className="flex items-center gap-0.5 shrink-0 text-[10px] leading-none text-muted-foreground/70"
                  title={`O mesmo contato também tem conversa em: ${tambemEm
                    .map((c) => c.nome)
                    .join(", ")}`}
                >
                  <Link2 className="w-3 h-3 shrink-0" aria-hidden />
                  <span className="truncate max-w-[112px]">
                    {tambemEm.length === 1
                      ? `também em ${tambemEm[0].nome}`
                      : `também em ${tambemEm.length} caixas`}
                  </span>
                </span>
              )}
              {stageLabel && (
                <span
                  className="text-[10px] leading-none px-1.5 py-0.5 rounded shrink-0 bg-muted text-muted-foreground/90 whitespace-nowrap"
                  title={`Etapa: ${stageLabel}`}
                >
                  {stageLabel}
                </span>
              )}
              {/* Autoria da última mensagem. `last_message_sent_source` é campo
                  de `whatsapp_messages`; no canal social a origem ainda não
                  existe (nada sai daqui nesta fatia), então o marcador se
                  resume ao "Você:" quando a direção for de saída. */}
              {isWhatsApp && contact.last_message_direction === "outgoing" && contact.last_message_sent_source === "workflow" && (
                <Zap className="h-2.5 w-2.5 text-[#a78bfa] shrink-0" />
              )}
              {isWhatsApp && contact.last_message_direction === "outgoing" && contact.last_message_sent_source === "copilot" && (
                <Bot className="h-2.5 w-2.5 text-[#fbbf24] shrink-0" />
              )}
              {contact.last_message_direction === "outgoing" &&
                (!isWhatsApp || !contact.last_message_sent_source || contact.last_message_sent_source === "manual") && (
                <span className="text-foreground/50 shrink-0" title="Você enviou">
                  Você:
                </span>
              )}
              <span className="truncate min-w-0">{contact.last_message || "Sem mensagens"}</span>
            </p>
            {contact.unread_count > 0 && !isSelected && (
              <Badge
                className="h-5 min-w-5 px-1.5 shrink-0 text-xs bg-primary text-primary-foreground border-0 hover:bg-primary/90 rounded-full"
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
