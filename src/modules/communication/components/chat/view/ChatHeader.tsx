/**
 * ChatHeader — topo do painel de chat: contato, ações e o ⋯.
 *
 * V5 ("mais perto do mockup", 02/10): o estado da IA saiu daqui para a
 * `AiStateStrip`, logo abaixo — a pílula, o switch e os selos disputavam a
 * mesma linha com as ações do contato. O que fica:
 *
 *   contato (avatar, nome, Ao vivo, telefone · caixa) · Ver/Criar lead ·
 *   Ligar · densidade (um botão, três opções) · ⋯ (não lida, arquivar,
 *   sincronizar histórico, transferir setor)
 *
 * Props: callbacks puros — sem hooks de mutation aqui, recebe handlers do pai.
 *
 * ─── Quem cede espaço, e em que ordem (2026-09-03) ──────────────────────────
 * O contato tem piso (`min-w-[11rem]`) e trunca em vez de quebrar linha; as
 * ações moram num grupo `shrink-0` de largura previsível; abaixo de `lg` o
 * rótulo "Ver lead" vira ícone com tooltip. O nome do contato é o último a
 * perder espaço. Sem `overflow-hidden` na raiz — ele escondia o problema em vez
 * de resolver, e recortava o anel de foco.
 */
import React, { useState } from "react";
import {
  ArrowLeft,
  UserCircle,
  Plus,
  ArrowRightLeft,
  Loader2,
  AlignJustify,
  List,
  LayoutList,
  AlertTriangle,
  MoreHorizontal,
  History,
  Mail,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChannelBadge } from "@/modules/communication/components/chat/ChannelBadge";
import { RealtimeStatusBadge } from "@/modules/communication/components/chat/RealtimeStatusBadge";
import { SyncChatDialog } from "@/modules/communication/components/chat/history-sync/SyncChatButton";
import { useMessageLimits } from "@/modules/communication/hooks/useMessageLimits";
import { getAvatarGradient } from "@/modules/communication/components/chat/list/avatarGradient";
import { VoiceCallButton } from "@/modules/communication/components/voice/VoiceCallButton";
import { legendaDoTelefone } from "@/modules/communication/lib/identificadorOculto";

export interface SzChatSession {
  sz_chat_session_id: string;
  team_mappings: Record<string, string>;
}

export interface ChatHeaderProps {
  phoneNumber: string;
  contactName: string;
  hasLead: boolean;
  leadId?: string;
  /** ID da instância WhatsApp — usado pra sincronizar histórico e MessageLimits */
  instanceId?: string;
  /** Nome da caixa por onde a conversa corre — vai na legenda, ao lado do telefone. */
  instanceName?: string;
  szChatSession: SzChatSession | null;
  organizationId: string | null;
  onBack: () => void;
  onOpenLeadModal?: () => void;
  onTransferToSzChatTeam: (teamName: string, teamId: string) => void;
  transferPending: boolean;
  /** Densidade atual — marca a opção ativa no menu (C11) */
  density?: DensityMode;
  /** Callback para alterar a densidade (C11) */
  onDensityChange?: (d: DensityMode) => void;
  /** "Marcar como não lida" — a mesma ação do menu da linha. */
  onMarkUnread?: () => void;
  /** Arquivar / desarquivar — a mesma ação do menu da linha. */
  isArchived?: boolean;
  onArchive?: () => void;
  onUnarchive?: () => void;
}

// ─── Densidade ────────────────────────────────────────────────────────────────

const DENSITY_OPTIONS: Array<{
  mode: DensityMode;
  icon: React.ElementType;
  label: string;
  descricao: string;
}> = [
  { mode: "compact",     icon: AlignJustify, label: "Compacto", descricao: "Mais mensagens na tela" },
  { mode: "comfortable", icon: List,         label: "Padrão",   descricao: "Equilíbrio entre leitura e volume" },
  { mode: "spacious",    icon: LayoutList,   label: "Espaçoso", descricao: "Mais respiro entre as bolhas" },
];

/**
 * Um botão, três opções com descrição — no lugar do grupo de três ícones, que
 * custava 90 px do cabeçalho para uma preferência que se escolhe uma vez.
 */
function DensityMenu({
  density = "comfortable",
  onDensityChange,
}: {
  density: DensityMode;
  onDensityChange: (d: DensityMode) => void;
}) {
  const atual = DENSITY_OPTIONS.find((o) => o.mode === density) ?? DENSITY_OPTIONS[1];
  const Icone = atual.icon;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label="Densidade das mensagens"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Icone className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">Densidade · {atual.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Densidade das mensagens</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={density} onValueChange={(v) => onDensityChange(v as DensityMode)}>
          {DENSITY_OPTIONS.map(({ mode, icon: Icon, label, descricao }) => (
            <DropdownMenuRadioItem key={mode} value={mode} className="items-start py-2">
              <Icon className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold">{label}</span>
                <span className="text-[11.5px] text-muted-foreground">{descricao}</span>
              </span>
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
  instanceId,
  instanceName,
  szChatSession,
  organizationId,
  onBack,
  onOpenLeadModal,
  onTransferToSzChatTeam,
  transferPending,
  density,
  onDensityChange,
  onMarkUnread,
  isArchived,
  onArchive,
  onUnarchive,
}: ChatHeaderProps) {
  const { data: limits } = useMessageLimits(instanceId ?? null, organizationId);
  const limitsPercent = limits?.current != null && limits?.limit != null && limits.limit > 0
    ? Math.round((limits.current / limits.limit) * 100) : null;
  const newChatsRestricted = limits?.can_send_new_messages === false;
  const limitsWarning = newChatsRestricted || (limitsPercent !== null && limitsPercent >= 80);
  const chatJid = phoneNumber ? `${phoneNumber.replace(/\D/g, "")}@s.whatsapp.net` : null;
  const avatarGradient = getAvatarGradient(phoneNumber || contactName);
  const [syncOpen, setSyncOpen] = useState(false);

  const podeSincronizar = !!instanceId && !!chatJid;
  const temSetores = !!szChatSession && Object.keys(szChatSession.team_mappings).length > 0;
  const podeArquivar = isArchived ? !!onUnarchive : !!onArchive;
  const temMais = podeSincronizar || temSetores || !!onMarkUnread || podeArquivar;

  return (
    // V5: a coluna da conversa é um cartão e pode ficar estreita (três colunas
    // redimensionáveis). A raiz QUEBRA em duas linhas em vez de empurrar as
    // ações para fora do cartão. O que não pode quebrar é a linha do NOME.
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 bg-card px-4 py-3">
      <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden shrink-0" aria-label="Voltar para a lista">
        <ArrowLeft className="w-5 h-5" />
      </Button>

      {/* Área clicável do contato */}
      <div
        role={onOpenLeadModal ? "button" : undefined}
        tabIndex={onOpenLeadModal ? 0 : undefined}
        className="flex items-center gap-3 flex-1 min-w-[11rem] cursor-pointer hover:bg-muted/60 -m-2 p-2 rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenLeadModal?.(); }}
        onPointerDown={(e) => { e.stopPropagation(); onOpenLeadModal?.(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenLeadModal?.(); } }}
      >
        <div className="relative shrink-0">
          <div
            className={cn(
              "flex h-10 w-10 select-none items-center justify-center rounded-full text-sm font-bold",
              // Letra escura/clara conforme o gradiente (cor do dado, não do tema).
              avatarGradient.ink ? "text-tinta" : "text-tinta-foreground",
            )}
            style={{ background: avatarGradient.background }}
            aria-hidden
          >
            {(contactName.charAt(0) || "?").toUpperCase()}
          </div>
          <ChannelBadge channel="whatsapp" size={16} overlay />
        </div>
        <div className="flex-1 min-w-0">
          {/* Nada quebra linha aqui: o nome trunca e os selos ficam presos à
              direita dele. Com `flex-wrap`, o "Ao vivo" caía para baixo do
              avatar, por trás do botão de ligar. */}
          <div className="flex items-center gap-2 flex-nowrap min-w-0">
            <h3 className="truncate min-w-0 text-[15px] font-bold tracking-tight text-foreground">{contactName}</h3>
            <RealtimeStatusBadge organizationId={organizationId} className="shrink-0" />
            {!hasLead && (
              <Badge variant="warning" className="shrink-0 text-xs">
                Sem lead
              </Badge>
            )}
          </div>
          {/* Legenda: telefone (mono) · caixa. Cada pedaço trunca sozinho. */}
          <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <span className="truncate font-mono text-[12px] tabular-nums">{legendaDoTelefone(phoneNumber)}</span>
            {instanceName && (
              <>
                <span aria-hidden className="shrink-0 opacity-50">·</span>
                <span className="min-w-0 truncate">{instanceName}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Grupo de ações: largura previsível, nunca encolhe. Ver lead · Ligar ·
          densidade · ⋯. Abaixo de `lg` os rótulos viram ícone com tooltip. */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Botão ver / criar lead */}
        {onOpenLeadModal && <Button
          type="button"
          variant={hasLead ? "outline" : "ink"}
          size="sm"
          className="shrink-0 gap-0"
          onClick={(e) => { e.stopPropagation(); onOpenLeadModal?.(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title={hasLead ? "Ver dados do lead e funis" : "Criar lead para este contato"}
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
        </Button>}

        {/* Ligar por WhatsApp (TorqueCalls). Some sozinho quando a org não tem
            número de voz conectado. */}
        <VoiceCallButton leadId={leadId} leadName={contactName} />

        {/* Limite de conversas novas — aviso, não ação: fica à vista. */}
        {limitsWarning && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="warning" className="shrink-0 gap-1 text-xs">
                <AlertTriangle className="h-3 w-3" />
                {newChatsRestricted ? "Restrição WhatsApp" : `${limits?.current}/${limits?.limit}`}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{newChatsRestricted ? "WhatsApp restringiu novas conversas nesta conta" : `Limite de novas conversas próximo (${limitsPercent}%)`}</TooltipContent>
          </Tooltip>
        )}

        {onDensityChange && (
          <DensityMenu density={density ?? "comfortable"} onDensityChange={onDensityChange} />
        )}

        {temMais && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label="Mais ações da conversa"
                disabled={transferPending}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {transferPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {onMarkUnread && (
                <DropdownMenuItem onSelect={onMarkUnread}>
                  <Mail className="mr-2 h-4 w-4" aria-hidden />
                  Marcar como não lida
                </DropdownMenuItem>
              )}
              {isArchived
                ? onUnarchive && (
                    <DropdownMenuItem onSelect={onUnarchive}>
                      <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden />
                      Desarquivar conversa
                    </DropdownMenuItem>
                  )
                : onArchive && (
                    <DropdownMenuItem onSelect={onArchive}>
                      <Archive className="mr-2 h-4 w-4" aria-hidden />
                      Arquivar conversa
                    </DropdownMenuItem>
                  )}
              {podeSincronizar && (
                <>
                  {(onMarkUnread || podeArquivar) && <DropdownMenuSeparator />}
                  <DropdownMenuItem onSelect={() => setSyncOpen(true)}>
                    <History className="mr-2 h-4 w-4" aria-hidden />
                    Sincronizar histórico
                  </DropdownMenuItem>
                </>
              )}
              {/* SZ.chat — só quando a sessão tem setores mapeados. */}
              {temSetores && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ArrowRightLeft className="mr-2 h-4 w-4" aria-hidden />
                    Transferir setor
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {Object.entries(szChatSession!.team_mappings).map(([teamName, teamId]) => (
                      <DropdownMenuItem
                        key={teamId}
                        onSelect={() => {
                          if (!organizationId) return;
                          onTransferToSzChatTeam(teamName, teamId);
                        }}
                      >
                        {teamName}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Fora do menu: o diálogo precisa sobreviver ao menu fechar. */}
      {syncOpen && instanceId && chatJid && (
        <SyncChatDialog instanceId={instanceId} chatJid={chatJid} open={syncOpen} onOpenChange={setSyncOpen} />
      )}
    </div>
  );
}
