/**
 * ChatHeader — topo do painel de chat: avatar, nome, badges, AI toggle, SZ.chat transfer.
 *
 * Extraído de WhatsAppChat.tsx ChatWindow header (C6).
 * C11: adiciona DensityToggle (3 botões ghost: compact/comfortable/spacious).
 * Props: callbacks puros — sem hooks de mutation aqui, recebe handlers do pai.
 *
 * ─── Quem cede espaço, e em que ordem (2026-09-03) ──────────────────────────
 * O cabeçalho é uma linha só: sete controles `shrink-0` e um bloco que encolhe,
 * o contato. Com dois números de voz o botão de ligar chegou a 200 px e o
 * contato colapsou até sobrar o avatar (medido na Milennials). A regra agora:
 * o contato tem piso (`min-w-[11rem]`) e trunca em vez de quebrar linha; as
 * ações moram num grupo `shrink-0` de largura previsível; abaixo de `lg` os
 * rótulos "Ligar" e "Ver lead" viram ícone com tooltip e a densidade entra num
 * menu "⋯". O nome do contato é o último a perder espaço. Sem `overflow-hidden`
 * na raiz — ele escondia o problema em vez de resolver, e recortava o anel de
 * foco.
 */
import React from "react";
import { ArrowLeft, Phone, UserCircle, Plus, Bot, UserPlus, ArrowRightLeft, Loader2, AlignJustify, List, LayoutList, AlertTriangle, MoreHorizontal } from "lucide-react";
import { TakeoverControls } from "@/modules/communication/components/chat/takeover/TakeoverControls";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DensityMode } from "@/modules/communication/components/chat/layout/ChatShell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChannelBadge } from "@/modules/communication/components/chat/ChannelBadge";
import { RealtimeStatusBadge } from "@/modules/communication/components/chat/RealtimeStatusBadge";
import { SyncChatButton } from "@/modules/communication/components/chat/history-sync/SyncChatButton";
import { useMessageLimits } from "@/modules/communication/hooks/useMessageLimits";
import { HumanPauseBadge } from "../HumanPauseBadge";
import { getAvatarGradient } from "@/modules/communication/components/chat/list/avatarGradient";
import { VoiceCallButton } from "@/modules/communication/components/voice/VoiceCallButton";

export interface SzChatSession {
  sz_chat_session_id: string;
  team_mappings: Record<string, string>;
}

export interface ChatHeaderProps {
  phoneNumber: string;
  contactName: string;
  hasLead: boolean;
  leadId?: string;
  /** ID da conversa — usado pelo TakeoverControls (C30) */
  conversationId?: string | null;
  /** ID da instância WhatsApp — usado pra SyncChatButton e MessageLimits */
  instanceId?: string;
  aiDisabled: boolean;
  isWaitingHuman: boolean;
  szChatSession: SzChatSession | null;
  organizationId: string | null;
  onBack: () => void;
  onOpenLeadModal: () => void;
  onToggleAi: (checked: boolean) => void;
  onTransferToSzChatTeam: (teamName: string, teamId: string) => void;
  toggleAiPending: boolean;
  transferPending: boolean;
  /** Densidade atual — usado para highlight do botão ativo no toggle (C11) */
  density?: DensityMode;
  /** Callback para alterar a densidade (C11) */
  onDensityChange?: (d: DensityMode) => void;
  /** Callback para abrir AITimeline — passado para TakeoverControls (C30) */
  onOpenTimeline?: () => void;
  /** Copilot está pausado por intervenção humana */
  humanPaused?: boolean;
  /** Timestamp até quando o copilot está pausado */
  humanPausedUntil?: Date | null;
  /** Callback para reativar copilot (limpar pausa) */
  onReactivateCopilot?: () => void;
  /** Mutation de reativação em andamento */
  isReactivating?: boolean;
}

// ─── Toggle de densidade ──────────────────────────────────────────────────────

const DENSITY_OPTIONS: Array<{
  mode: DensityMode;
  icon: React.ElementType;
  label: string;
}> = [
  { mode: "compact",     icon: AlignJustify, label: "Compacto" },
  { mode: "comfortable", icon: List,         label: "Padrão" },
  { mode: "spacious",    icon: LayoutList,   label: "Espaçoso" },
];

function DensityToggle({
  density = "comfortable",
  onDensityChange,
}: {
  density: DensityMode;
  onDensityChange: (d: DensityMode) => void;
}) {
  return (
    <div className="hidden lg:flex items-center gap-0.5 shrink-0" role="group" aria-label="Modo de densidade das mensagens">
      {DENSITY_OPTIONS.map(({ mode, icon: Icon, label }) => (
        <Tooltip key={mode}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 w-7 p-0",
                density === mode
                  ? "ring-2 ring-ring ring-offset-1 ring-offset-background bg-muted/60"
                  : "opacity-50 hover:opacity-100",
              )}
              onClick={() => onDensityChange(mode)}
              aria-pressed={density === mode}
              aria-label={label}
            >
              <Icon className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * A densidade abaixo de `lg`: os três ícones cedem lugar a um "⋯" com as mesmas
 * três opções — mesmo handler, e o item marcado diz qual está ativa. Segue
 * só do `md` para cima, como os três ícones sempre foram: no celular o
 * cabeçalho é outro (`MobileChatThreadHeader`).
 */
function DensityOverflowMenu({
  density = "comfortable",
  onDensityChange,
}: {
  density: DensityMode;
  onDensityChange: (d: DensityMode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="hidden md:inline-flex lg:hidden h-7 w-7 p-0 shrink-0 text-muted-foreground"
          aria-label="Mais opções"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Densidade das mensagens</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={density} onValueChange={(v) => onDensityChange(v as DensityMode)}>
          {DENSITY_OPTIONS.map(({ mode, icon: Icon, label }) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              <Icon className="mr-2 w-3.5 h-3.5 text-muted-foreground" aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatHeader({
  phoneNumber,
  contactName,
  hasLead,
  leadId,
  conversationId,
  instanceId,
  aiDisabled,
  isWaitingHuman,
  szChatSession,
  organizationId,
  onBack,
  onOpenLeadModal,
  onToggleAi,
  onTransferToSzChatTeam,
  toggleAiPending,
  transferPending,
  density,
  onDensityChange,
  onOpenTimeline,
  humanPaused,
  humanPausedUntil,
  onReactivateCopilot,
  isReactivating,
}: ChatHeaderProps) {
  const { data: limits } = useMessageLimits(instanceId ?? null, organizationId);
  const limitsWarning = limits && limits.limit > 0 && (limits.current / limits.limit) >= 0.8;
  const chatJid = phoneNumber ? `${phoneNumber.replace(/\D/g, "")}@s.whatsapp.net` : null;
  const avatarGradient = getAvatarGradient(phoneNumber || contactName);
  return (
    <div className="flex items-center gap-3 p-3 border-b border-border/60 bg-background shrink-0 min-w-0">
      <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden shrink-0">
        <ArrowLeft className="w-5 h-5" />
      </Button>

      {/* Área clicável do contato */}
      <div
        role="button"
        tabIndex={0}
        className="flex items-center gap-3 flex-1 min-w-[11rem] cursor-pointer hover:bg-muted/50 -m-2 p-2 rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenLeadModal(); }}
        onPointerDown={(e) => { e.stopPropagation(); onOpenLeadModal(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenLeadModal(); } }}
      >
        <div className="relative shrink-0">
          <div
            className={cn(
              "w-10 h-10 rounded-full border-2 border-background shadow-sm flex items-center justify-center font-semibold text-sm select-none",
              avatarGradient.ink ? "text-[#1c1c1c]" : "text-white",
            )}
            style={{ background: avatarGradient.background }}
            aria-hidden
          >
            {(contactName.charAt(0) || "?").toUpperCase()}
          </div>
          <ChannelBadge channel="whatsapp" size={16} overlay />
        </div>
        <div className="flex-1 min-w-0">
          {/* Nada quebra linha aqui: o nome trunca e os badges ficam presos à
              direita dele. Com `flex-wrap`, o "Ao vivo" caía para baixo do
              avatar, por trás do botão de ligar. */}
          <div className="flex items-center gap-2 flex-nowrap min-w-0">
            <h3 className="font-display font-semibold truncate min-w-0 text-foreground">{contactName}</h3>
            <RealtimeStatusBadge organizationId={organizationId} className="shrink-0" />
            {!hasLead && (
              <Badge
                variant="secondary"
                className="text-xs shrink-0 text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40 border-0"
              >
                Sem lead
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground flex items-center gap-1 truncate">
            <Phone className="w-3 h-3 shrink-0" />
            {phoneNumber}
          </p>
        </div>
      </div>

      {/* Grupo de ações: largura previsível, nunca encolhe. Ligar ▾ · Ver lead ·
          histórico. Abaixo de `lg` os rótulos viram ícone com tooltip. */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Ligar por WhatsApp (TorqueCalls). Some sozinho quando a org não tem
            número de voz conectado. */}
        <VoiceCallButton leadId={leadId} leadName={contactName} />

        {/* Botão ver / criar lead */}
        <Button
          type="button"
          variant={hasLead ? "ghost" : "outline"}
          size="sm"
          className={cn("shrink-0 gap-0", !hasLead && "border-primary text-primary hover:bg-primary/10")}
          onClick={(e) => { e.stopPropagation(); onOpenLeadModal(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title={hasLead ? "Ver dados do lead e pipeline" : "Criar lead para este contato"}
          aria-label={hasLead ? "Ver lead" : "Criar lead"}
        >
          {hasLead ? (
            <>
              <UserCircle className="w-4 h-4 lg:mr-1.5" />
              <span className="hidden lg:inline">Ver lead</span>
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 lg:mr-1.5" />
              <span className="hidden lg:inline">Criar Lead</span>
            </>
          )}
        </Button>

        {/* Sync history per-chat */}
        {instanceId && chatJid && (
          <SyncChatButton instanceId={instanceId} chatJid={chatJid} />
        )}
      </div>

      {/* Separa as ações do contato do bloco de estado da conversa (IA, densidade). */}
      <div className="hidden md:block h-5 w-px bg-border/60 shrink-0" aria-hidden />

      {/* Message limits warning */}
      {limitsWarning && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="border-amber-400 text-amber-500 gap-1 text-xs shrink-0">
              <AlertTriangle className="h-3 w-3" />
              {limits!.current}/{limits!.limit}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Limite de mensagens próximo ({Math.round((limits!.current / limits!.limit) * 100)}%)</TooltipContent>
        </Tooltip>
      )}

      {/* TakeoverControls — FSM IA↔humano (C30) — desktop only */}
      <div className="hidden md:block">
        {/* `conversationId` chega `string | null | undefined` (null = conversa
            sem registro ainda). TakeoverControls aceita `string | undefined` —
            normaliza no ponto de passagem em vez de afrouxar a prop do filho. */}
        <TakeoverControls
          conversationId={conversationId ?? undefined}
          onOpenTimeline={onOpenTimeline}
        />
      </div>

      {/* AI Toggle — desktop only */}
      <div
        className={cn(
          "hidden md:flex items-center gap-1.5 px-2 py-1 rounded-full border border-border/40 shrink-0",
          aiDisabled ? "bg-muted/30" : "bg-primary/8"
        )}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Bot className={cn("w-3.5 h-3.5", aiDisabled ? "text-muted-foreground/50" : "text-primary/70")} />
        <span className="text-[11px] text-muted-foreground/70 hidden sm:inline">IA</span>
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={!aiDisabled}
            onCheckedChange={onToggleAi}
            disabled={toggleAiPending}
          />
        </div>
      </div>

      {/* Human pause badge — desktop only, takes visual priority */}
      {humanPaused && humanPausedUntil && onReactivateCopilot && (
        <HumanPauseBadge
          pausedUntil={humanPausedUntil}
          onReactivate={onReactivateCopilot}
          isReactivating={isReactivating ?? false}
        />
      )}

      {/* Transfer / AI state badges — desktop only */}
      {hasLead && leadId && isWaitingHuman && (
        <Badge variant="outline" className="hidden md:inline-flex border-amber-400 text-amber-600 gap-1.5 text-xs">
          <UserPlus className="h-3 w-3" />
          Aguardando humano
        </Badge>
      )}
      {aiDisabled && !isWaitingHuman && !humanPaused && (
        <Badge variant="outline" className="hidden md:inline-flex text-muted-foreground gap-1.5 text-xs">
          IA desativada
        </Badge>
      )}

      {/* Density: três ícones do `lg` para cima; "⋯" entre `md` e `lg`. */}
      {onDensityChange && (
        <>
          <DensityToggle density={density ?? "comfortable"} onDensityChange={onDensityChange} />
          <DensityOverflowMenu density={density ?? "comfortable"} onDensityChange={onDensityChange} />
        </>
      )}

      {/* SZ.chat transfer dropdown */}
      {szChatSession && Object.keys(szChatSession.team_mappings).length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 text-xs"
              disabled={transferPending}
            >
              {transferPending ? (
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
                  if (!organizationId) return;
                  onTransferToSzChatTeam(teamName, teamId);
                }}
              >
                {teamName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
