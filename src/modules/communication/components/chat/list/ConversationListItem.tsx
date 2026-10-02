/**
 * ConversationListItem — linha de conversa no inbox + ContactContextMenu co-locado.
 *
 * Extraído de WhatsAppChat.tsx (C5).
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Mail,
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
  onMarkUnread?: (phone: string, instanceId?: string | null) => void;
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
  onMarkUnread,
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
            // Recolhido (largura zero, invisível) até a linha ter mouse ou foco,
            // ou o menu estar aberto — assim não rouba espaço do nome. Continua
            // no DOM e alcançável por teclado (o foco o expande).
            className="-mr-1 w-0 shrink-0 overflow-hidden rounded-md p-0 opacity-0 transition-[width,opacity] duration-150 hover:bg-muted/80 focus-visible:w-6 focus-visible:p-1 focus-visible:opacity-100 group-hover/linha:w-6 group-hover/linha:p-1 group-hover/linha:opacity-100 group-focus-within/linha:w-6 group-focus-within/linha:p-1 group-focus-within/linha:opacity-100 data-[state=open]:w-6 data-[state=open]:p-1 data-[state=open]:opacity-100 group-data-[selected=true]/linha:hover:bg-primary-foreground/10"
            aria-label="Opções da conversa"
          >
            <MoreVertical className="h-3.5 w-3.5 text-muted-foreground group-data-[selected=true]/linha:text-primary-foreground/70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
          {onMarkUnread && contact.instance_id && <DropdownMenuItem onClick={() => onMarkUnread(contact.phone_number, contact.instance_id)}><Mail className="w-4 h-4 mr-2" />Marcar como não lido</DropdownMenuItem>}
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
  onMarkUnread?: (phone: string, instanceId?: string | null) => void;
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
  waitingHumanLeadIds,
  activeTab,
  isAdmin,
  instanceId,
  organizationId,
  allTags,
  onMarkUnread,
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
  const naoLida = contact.unread_count > 0 && !isSelected;
  // A última mensagem saiu do Copilot — o selo "IA" vai ao lado do nome, como
  // no mockup. Só o WhatsApp grava a origem (`last_message_sent_source`).
  const ultimaDaIa =
    isWhatsApp &&
    contact.last_message_direction === "outgoing" &&
    contact.last_message_sent_source === "copilot";
  // "Pediu atendente": a mesma fila de handoff que alimenta o chip do trilho
  // (`waiting-human-leads`). O dado já chegava aqui e não era desenhado.
  const pediuAtendente =
    !!contact.lead_id && (waitingHumanLeadIds?.has(contact.lead_id) ?? false);

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
      data-selected={isSelected}
      className={cn(
        // V5: linha arredondada; a selecionada vira ouro (como no painel de
        // tinta do Comando). O resto da linha lê `data-selected` pelo grupo.
        "group/linha relative w-full cursor-pointer rounded-2xl px-2.5 py-2.5 text-left outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary",
        isSelected
          ? "bg-primary text-primary-foreground shadow-brilho-ouro"
          : "hover:bg-foreground/[.05]",
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
              className="h-11 w-11 rounded-full object-cover"
            />
          ) : (
            <div
              className={cn(
                "flex h-11 w-11 select-none items-center justify-center rounded-full text-sm font-bold",
                // Letra escura ou clara conforme o gradiente do avatar (cor do
                // dado, derivada do nome). Os tokens de tinta são os mesmos nos
                // dois temas — o contraste é com o gradiente, não com a página.
                avatarGradient.ink ? "text-tinta" : "text-tinta-foreground",
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
          {/* Andar 1 — nome · IA · hora. O NOME tem prioridade: é o que a
              pessoa procura ao varrer a lista. O ⋮ fica no canto, depois da
              hora, e só ocupa espaço sob o mouse, no foco ou com o menu aberto. */}
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-bold">{displayName}</span>
            {/* "Sem lead ainda" é informação onde o vínculo é possível. O ponto
                some assim que alguém vincula, nos dois canais. */}
            {!contact.lead_id && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary/70 group-data-[selected=true]/linha:bg-primary-foreground/60" title="Novo" />
            )}
            {ultimaDaIa && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-primary/15 px-1 py-px text-[10px] font-bold leading-none text-primary group-data-[selected=true]/linha:bg-primary-foreground/10 group-data-[selected=true]/linha:text-primary-foreground"
                title="A última mensagem foi do Copilot"
              >
                <Bot className="h-2.5 w-2.5" aria-hidden />
                IA
              </span>
            )}
            <time
              dateTime={contact.last_message_time || ""}
              className={cn(
                "ml-auto shrink-0 whitespace-nowrap text-[11px] tabular-nums",
                naoLida
                  ? "font-bold text-primary"
                  : "font-semibold text-muted-foreground group-data-[selected=true]/linha:text-primary-foreground/70",
              )}
            >
              {formatContactTime(contact.last_message_time)}
            </time>
            {isWhatsApp && (
              <ContactContextMenu
                contact={contact}
                activeTab={activeTab}
                isAdmin={isAdmin}
                instanceId={instanceId}
                organizationId={organizationId}
                allTags={allTags}
                onMarkUnread={onMarkUnread}
                onArchive={onArchive}
                onUnarchive={onUnarchive}
                onDelete={onDelete}
                onAddTag={onAddTag}
                onRemoveTag={onRemoveTag}
              />
            )}
          </div>

          {/* Andar 2 — prévia (com a autoria) · contador. */}
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1 truncate text-[12px]",
                naoLida
                  ? "font-semibold text-foreground/85"
                  : "text-muted-foreground group-data-[selected=true]/linha:text-primary-foreground/75",
              )}
            >
              {/* Autoria da última mensagem. `last_message_sent_source` é campo
                  de `whatsapp_messages`; no canal social a origem ainda não
                  existe, então o marcador se resume ao "Você:" de saída. */}
              {isWhatsApp && contact.last_message_direction === "outgoing" && contact.last_message_sent_source === "workflow" && (
                <Zap className="h-2.5 w-2.5 shrink-0 text-bubble-workflow-foreground group-data-[selected=true]/linha:text-primary-foreground" />
              )}
              {ultimaDaIa && (
                <span className="shrink-0 opacity-70">IA:</span>
              )}
              {contact.last_message_direction === "outgoing" &&
                (!isWhatsApp || !contact.last_message_sent_source || contact.last_message_sent_source === "manual") && (
                <span className="shrink-0 opacity-70" title="Você enviou">
                  Você:
                </span>
              )}
              <span className="min-w-[3.5rem] flex-1 truncate">{contact.last_message || "Sem mensagens"}</span>
            </p>
            {naoLida && (
              <Badge
                className="h-5 min-w-5 shrink-0 rounded-full border-0 bg-primary px-1.5 text-[10.5px] font-extrabold tabular-nums text-primary-foreground hover:bg-primary/90"
                title="Mensagens não lidas"
              >
                {contact.unread_count > 99 ? "99+" : contact.unread_count}
              </Badge>
            )}
          </div>

          {/* Andar 3 — metadados em 10,5 px: de qual caixa corre · etapa ·
              pediu atendente · etiqueta · o "fio". Uma linha só, truncando —
              altura variável quebraria a lista virtualizada. */}
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[10.5px] leading-none text-muted-foreground group-data-[selected=true]/linha:text-primary-foreground/70">
            {/* A cor é a MESMA que a bolha de chat dá ao número — duas
                derivações dariam duas cores para a mesma caixa. */}
            {caixa && (
              <span
                className="flex min-w-0 max-w-[132px] shrink items-center gap-1"
                title={`Caixa: ${caixa.nome}`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: instanceColor(caixa.id) }}
                  aria-hidden
                />
                <span className="truncate">{caixa.nome}</span>
              </span>
            )}
            {/* No WhatsApp o nome do lead JÁ é o título da linha. No Instagram
                o título é o @handle, então o lead vinculado ganha a meta. */}
            {!isWhatsApp && contact.lead_name && (
              <span className="min-w-0 max-w-[104px] shrink truncate" title={`Lead: ${contact.lead_name}`}>
                {contact.lead_name}
              </span>
            )}
            {stageLabel && (
              <span
                className="flex min-w-0 max-w-[7.5rem] shrink items-center gap-1"
                title={`Etapa: ${stageLabel}`}
              >
                <span className="h-1 w-1 shrink-0 rounded-full bg-current opacity-60" aria-hidden />
                <span className="truncate">{stageLabel}</span>
              </span>
            )}
            {pediuAtendente && (
              <span className="flex shrink-0 items-center gap-1 font-semibold text-destructive group-data-[selected=true]/linha:text-primary-foreground">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive group-data-[selected=true]/linha:bg-primary-foreground" aria-hidden />
                Pediu atendente
              </span>
            )}
            {contact.tags.length > 0 && (
              <span
                className="flex min-w-[2.25rem] shrink-[999] items-center gap-1 overflow-hidden"
                title={contact.tags.map((t) => t.name).join(", ")}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: contact.tags[0].color }}
                  aria-hidden
                />
                <span className="min-w-0 truncate">{contact.tags[0].name}</span>
                {contact.tags.length > 1 && (
                  <span className="shrink-0 font-semibold">+{contact.tags.length - 1}</span>
                )}
              </span>
            )}
            {/* O FIO. Texto, e não só um ícone: cor e forma sozinhas não dizem
                QUAL é a outra caixa, e é justamente isso que decide se a
                pessoa responde aqui ou lá. */}
            {tambemEm && tambemEm.length > 0 && (
              <span
                className="flex min-w-0 shrink items-center gap-0.5 opacity-80"
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
          </div>
        </div>
      </div>
    </motion.div>
  );
}
