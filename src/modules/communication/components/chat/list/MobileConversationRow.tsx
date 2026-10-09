/**
 * MobileConversationRow — linha da lista de conversas no celular.
 *
 * Pure presentational: no state, no dropdown menus, no complex interactions.
 * Just avatar + text + badges + tap handler.
 *
 * V5: mesmo vocabulário da linha do desktop (mockup) — três andares
 * (nome · IA · hora / prévia · contador / responsável · pediu atendente), avatar no
 * gradiente do contato e a selecionada em ouro. O celular segue lista →
 * conversa; só a linha muda de forma.
 */
import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  contactAvatarSeed,
  contactKey,
  isWhatsAppContact,
  type InboxContact,
} from "@/modules/communication/hooks/chat/types";
import type { CaixaDaLinha } from "@/modules/communication/lib/caixaUnificada";
import type { ResponsavelDaLinha } from "@/modules/communication/lib/responsavelDaLinha";
import { ChannelBadge } from "../ChannelBadge";
import { getAvatarGradient } from "./avatarGradient";
import { useNomeDoLeadPrimeiro } from "@/modules/communication/hooks/chat/useNomeDoLeadPrimeiro";
import { useNomeCodContatoLead } from "@/modules/communication/hooks/chat/useNomeCodContatoLead";
import { contactDisplayName, formatContactTime, SegmentoResponsavel } from "./ConversationListItem";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface MobileConversationRowProps {
  contact: InboxContact;
  isSelected: boolean;
  /** Recebe `contactKey(contact)` — telefone no WhatsApp, `conversation_key` no social. */
  onPress: (key: string) => void;
  onLongPress?: (key: string) => void;
  stageName?: string | null;
  stageColor?: string | null;
  /** Fila de handoff (`waiting-human-leads`) — a mesma do desktop. */
  waitingHumanLeadIds?: Set<string>;
  /** A caixa de onde a conversa corre — vai no tooltip do responsável. */
  caixa?: CaixaDaLinha;
  /** Dono do lead — mesmo contrato de `ConversationListItemProps.responsavel`. */
  responsavel?: ResponsavelDaLinha | null;
  /** Mais de uma caixa marcada: a bolinha ganha a cor da caixa. */
  variasCaixas?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MobileConversationRow({
  contact,
  isSelected,
  onPress,
  onLongPress,
  stageName,
  stageColor,
  waitingHumanLeadIds,
  caixa,
  responsavel,
  variasCaixas,
}: MobileConversationRowProps) {
  const nomeDoLeadPrimeiro = useNomeDoLeadPrimeiro();
  const nomeCodContato = useNomeCodContatoLead();
  const name = contactDisplayName(contact, nomeDoLeadPrimeiro, nomeCodContato);
  const initials = (name.replace("@", "").charAt(0) || "?").toUpperCase();
  const avatarGradient = getAvatarGradient(contactAvatarSeed(contact));
  const hasUnread = contact.unread_count > 0 && !isSelected;
  const key = contactKey(contact);
  // Predicado, nao comparacao inline: alem do default de canal ausente, ele
  // ESTREITA a uniao — sem isso o TS perde `last_message_sent_source` e
  // `avatar_url`. Ver o comentario de `isWhatsAppContact`.
  const isWhatsApp = isWhatsAppContact(contact);

  const isOutgoingManual =
    contact.last_message_direction === "outgoing" &&
    (!isWhatsApp ||
      !contact.last_message_sent_source ||
      contact.last_message_sent_source === "manual");

  const isOutgoingWorkflow =
    isWhatsApp &&
    contact.last_message_direction === "outgoing" &&
    contact.last_message_sent_source === "workflow";

  // Selo "IA" = a ÚLTIMA mensagem saiu do Copilot (mesma regra do desktop).
  // Não é estado da IA na conversa — esse ficou fora da linha (decisão D5).
  const ultimaDaIa =
    isWhatsApp &&
    contact.last_message_direction === "outgoing" &&
    contact.last_message_sent_source === "copilot";

  const pediuAtendente =
    !!contact.lead_id && (waitingHumanLeadIds?.has(contact.lead_id) ?? false);
  // Mesmo critério do `SegmentoResponsavel`: sem dono a afirmar, o modo
  // unificado ainda mostra a caixa.
  const temMeta = responsavel !== undefined || (!!variasCaixas && !!caixa) || pediuAtendente;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Conversa com ${name}`}
      aria-pressed={isSelected}
      data-selected={isSelected}
      className={cn(
        "group/linha mx-2 flex cursor-pointer select-none items-start gap-3 rounded-2xl px-2.5 py-2.5 transition-colors",
        isSelected
          ? "bg-primary text-primary-foreground shadow-brilho-ouro"
          : "active:bg-muted/60",
      )}
      onClick={() => onPress(key)}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault();
          onLongPress(key);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress(key);
        }
      }}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        {!isWhatsApp && contact.avatar_url ? (
          <img src={contact.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
        ) : (
          <div
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold",
              avatarGradient.ink ? "text-tinta" : "text-tinta-foreground",
            )}
            style={{ background: avatarGradient.background }}
            aria-hidden
          >
            {initials}
          </div>
        )}
        <ChannelBadge channel={contact.channel} size={16} overlay />
      </div>

      <div className="min-w-0 flex-1">
        {/* Andar 1 — nome · IA · hora */}
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("min-w-0 truncate text-sm", hasUnread ? "font-extrabold" : "font-bold")}>
            {name}
          </span>
          {ultimaDaIa && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-primary/15 px-1 py-px text-[10px] font-bold leading-none text-primary-soft-foreground group-data-[selected=true]/linha:bg-primary-foreground/10 group-data-[selected=true]/linha:text-primary-foreground"
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
              hasUnread
                ? "font-bold text-primary-soft-foreground"
                : "font-semibold text-muted-foreground group-data-[selected=true]/linha:text-primary-foreground/70",
            )}
          >
            {formatContactTime(contact.last_message_time)}
          </time>
        </div>

        {/* Andar 2 — prévia · etapa · contador */}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 truncate text-[12.5px]",
              hasUnread
                ? "font-semibold text-foreground/85"
                : "text-muted-foreground group-data-[selected=true]/linha:text-primary-foreground/75",
            )}
          >
            {isOutgoingWorkflow && (
              <span className="shrink-0 text-[10px] font-semibold text-bubble-workflow-foreground">Auto:</span>
            )}
            {ultimaDaIa && <span className="shrink-0 opacity-70">IA:</span>}
            {isOutgoingManual && <span className="shrink-0 opacity-70">Você:</span>}
            <span className="truncate min-w-0">
              {contact.last_message || "Sem mensagens"}
            </span>
          </p>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Stage chip */}
            {stageName && stageColor && (
              <span
                className="text-[10px] leading-none px-1.5 py-0.5 rounded-full whitespace-nowrap font-medium"
                style={{
                  backgroundColor: `${stageColor}33`,
                  color: stageColor,
                }}
              >
                {stageName}
              </span>
            )}

            {/* Unread badge */}
            {hasUnread && (
              <Badge className="h-5 min-w-5 border-0 bg-primary px-1.5 text-[10.5px] font-extrabold tabular-nums text-primary-foreground hover:bg-primary">
                {contact.unread_count > 99 ? "99+" : contact.unread_count}
              </Badge>
            )}
          </div>
        </div>

        {/* Andar 3 — responsável · pediu atendente. Some quando não há o que dizer. */}
        {temMeta && (
          <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-[10.5px] leading-none text-muted-foreground group-data-[selected=true]/linha:text-primary-foreground/70">
            <SegmentoResponsavel
              responsavel={responsavel}
              caixa={caixa}
              variasCaixas={variasCaixas}
              className="min-w-0 shrink"
            />
            {pediuAtendente && (
              <span className="flex shrink-0 items-center gap-1 font-semibold text-destructive group-data-[selected=true]/linha:text-primary-foreground">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive group-data-[selected=true]/linha:bg-primary-foreground"
                  aria-hidden
                />
                Pediu atendente
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
