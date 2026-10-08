/**
 * AiStateStrip — a faixa de estado da IA, logo abaixo do cabeçalho da conversa.
 *
 * Substitui a pílula com menu (`TakeoverControls`), o `Switch` "IA" solto, os
 * selos "Aguardando humano"/"IA desativada" e o banner "IA pediu ajuda" — eram
 * quatro superfícies dizendo pedaços do mesmo estado em lugares diferentes.
 *
 * ─── O QUE ELA OFERECE (decisão do CTO, D3) ─────────────────────────────────
 *
 * SÓ as transições que a máquina de estados aceita a partir do estado atual —
 * as mesmas que o menu de `TakeoverControls` já oferecia, e que o gatilho
 * `enforce_ai_state_transition` permite (o resto devolve 23514):
 *
 *   AI_ACTIVE         → pausar (agora · após resposta · sem retomar)
 *   AI_PAUSED_MANUAL  → retomar · assumir
 *   WAITING_HUMAN     → assumir · deixar com a IA
 *   HUMAN_ACTIVE      → devolver para a IA · pausar permanente
 *   HANDOFF_BACK      → retomar agora
 *
 * Até dois botões visíveis; o resto vai para o ⋯. O mockup oferecia "Assumir
 * conversa" com a IA ativa e no "Retomando" — a máquina recusa, então aqui não.
 *
 * O switch "IA" é OUTRO conceito (Copilot ligado/desligado para o LEAD,
 * `useCopilotToggle`), e fica à direita da faixa, como antes no cabeçalho.
 *
 * Nenhuma regra nova: os handlers são os do `useTakeover`, que já valida e
 * avisa com toast. Esta peça só decide a forma.
 */
import { Bot, Info, Loader2, MoreHorizontal, Pause, RefreshCw, User, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTakeover } from "@/modules/communication/hooks/chat/useTakeover";
import type { AiStateResumeMode, AiTakeoverState } from "@/modules/communication/lib/chat-types";
import { HumanPauseBadge } from "../HumanPauseBadge";
import { AI_STATE_CONFIG } from "./aiStateLabels";

export interface AiStateStripProps {
  /** Conversa (FSM `conversations.ai_state`). Sem ela, só o switch do lead. */
  conversationId: string | null | undefined;
  /** Copilot desligado para o LEAD (`useCopilotToggle`). */
  aiDisabled: boolean;
  onToggleAi: (checked: boolean) => void;
  toggleAiPending: boolean;
  /** Pausa por intervenção humana (`useCopilotPause`). */
  humanPaused?: boolean;
  humanPausedUntil?: Date | null;
  onReactivateCopilot?: () => void;
  isReactivating?: boolean;
  /** Abre o histórico da IA. Sem handler, o item não aparece. */
  onOpenTimeline?: () => void;
  className?: string;
}

type Acao = {
  rotulo: string;
  icon: LucideIcon;
  run: () => Promise<void>;
};

interface Visual {
  /** Fundo da faixa. */
  faixa: string;
  /** Chip do ícone. */
  chip: string;
  /** Linha de explicação. */
  texto: string;
}

const VISUAL: Record<AiTakeoverState | "LEAD_OFF", Visual> = {
  AI_ACTIVE: { faixa: "bg-primary-soft", chip: "bg-primary text-primary-foreground", texto: "text-primary-soft-foreground/80" },
  AI_PAUSED_MANUAL: { faixa: "bg-muted", chip: "bg-card text-muted-foreground shadow-relevo", texto: "text-muted-foreground" },
  WAITING_HUMAN: { faixa: "bg-destructive/10", chip: "bg-destructive text-destructive-foreground", texto: "text-foreground/75" },
  HUMAN_ACTIVE: { faixa: "dark bg-tinta text-tinta-foreground", chip: "bg-primary text-primary-foreground", texto: "text-tinta-muted" },
  HANDOFF_BACK: { faixa: "bg-insights/10", chip: "bg-card text-insights shadow-relevo", texto: "text-foreground/75" },
  LEAD_OFF: { faixa: "bg-muted", chip: "bg-card text-muted-foreground shadow-relevo", texto: "text-muted-foreground" },
};

function explicacaoDaPausa(modo: AiStateResumeMode | null): string {
  if (modo === "after_response") return "Retoma depois da próxima resposta do lead.";
  if (modo === "dont_resume") return "Não retoma sozinha — retome quando quiser.";
  if (modo === "immediate") return "Retoma assim que você liberar.";
  return "Ninguém responde automaticamente até a IA ser retomada.";
}

export function AiStateStrip({
  conversationId,
  aiDisabled,
  onToggleAi,
  toggleAiPending,
  humanPaused,
  humanPausedUntil,
  onReactivateCopilot,
  isReactivating,
  onOpenTimeline,
  className,
}: AiStateStripProps) {
  const { state, resumeMode, isMutating, pauseAi, resumeAi, markHumanActive, markHandoffBack } =
    useTakeover(conversationId);

  const temConversa = !!conversationId;
  const humanoConduzindo = temConversa && state === "HUMAN_ACTIVE";
  // Mesma regra que o cabeçalho aplicava: com um humano conduzindo, o switch
  // aparece desligado e travado — ligar o Copilot ali brigaria com a pessoa.
  const switchDesligado = aiDisabled || humanoConduzindo;

  // Lead com o Copilot desligado e a conversa em "IA ativa": a FSM diz ativa,
  // mas ninguém vai responder. A faixa conta o que acontece de fato.
  const leadDesligado = aiDisabled && (!temConversa || state === "AI_ACTIVE");
  const chave: AiTakeoverState | "LEAD_OFF" = leadDesligado ? "LEAD_OFF" : temConversa ? state : "AI_ACTIVE";
  const visual = VISUAL[chave];

  const config = AI_STATE_CONFIG[temConversa ? state : "AI_ACTIVE"];
  const Icone: LucideIcon = leadDesligado ? Bot : config.icon;
  const titulo = leadDesligado ? "IA desligada para este lead" : config.label;
  const explicacao = (() => {
    if (leadDesligado) return "O Copilot não responde este lead até alguém religar a IA.";
    switch (chave) {
      case "AI_ACTIVE": return "O Copilot está respondendo este lead.";
      case "AI_PAUSED_MANUAL": return explicacaoDaPausa(resumeMode);
      case "WAITING_HUMAN": return "A IA pediu ajuda: alguém precisa assumir a conversa.";
      case "HUMAN_ACTIVE": return "A IA não responde enquanto você conduz.";
      case "HANDOFF_BACK": return "A conversa está voltando para o Copilot.";
      default: return "";
    }
  })();

  // ── Transições por estado — as MESMAS do menu de TakeoverControls ────────
  const visiveis: Acao[] = [];
  const noMenu: Acao[] = [];
  if (temConversa && !leadDesligado) {
    switch (state) {
      case "AI_ACTIVE":
        visiveis.push({ rotulo: "Pausar IA", icon: Pause, run: () => pauseAi("immediate") });
        noMenu.push(
          { rotulo: "Pausar após resposta", icon: Pause, run: () => pauseAi("after_response") },
          { rotulo: "Não retomar automaticamente", icon: Pause, run: () => pauseAi("dont_resume") },
        );
        break;
      case "AI_PAUSED_MANUAL":
        visiveis.push(
          { rotulo: "Retomar IA", icon: Bot, run: () => resumeAi() },
          { rotulo: "Assumir conversa", icon: User, run: () => markHumanActive() },
        );
        break;
      case "WAITING_HUMAN":
        visiveis.push(
          { rotulo: "Deixar com a IA", icon: Bot, run: () => resumeAi() },
          { rotulo: "Assumir conversa", icon: User, run: () => markHumanActive() },
        );
        break;
      case "HUMAN_ACTIVE":
        visiveis.push({ rotulo: "Devolver para a IA", icon: RefreshCw, run: () => markHandoffBack() });
        noMenu.push({ rotulo: "Pausar IA permanente", icon: Pause, run: () => pauseAi("dont_resume") });
        break;
      case "HANDOFF_BACK":
        visiveis.push({ rotulo: "Retomar IA agora", icon: Bot, run: () => resumeAi() });
        break;
    }
  }
  const temMenu = noMenu.length > 0 || !!onOpenTimeline;
  const naTinta = chave === "HUMAN_ACTIVE";

  return (
    <div
      role={chave === "WAITING_HUMAN" ? "alert" : "group"}
      aria-label={leadDesligado ? titulo : config.ariaLabel}
      data-testid="ai-state-strip"
      data-state={chave}
      className={cn(
        "flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2.5",
        visual.faixa,
        className,
      )}
    >
      {/* Aria live — leitor de tela anuncia a troca de estado. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {leadDesligado ? titulo : config.ariaLabel}
      </div>

      <div className="flex min-w-[12rem] flex-1 items-center gap-2.5">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-[9px]", visual.chip)}>
          {isMutating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Icone className="h-3.5 w-3.5" aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold leading-tight">{titulo}</p>
          <p className={cn("truncate text-xs leading-snug", visual.texto)}>{explicacao}</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="O que significa este estado"
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Info className="h-3.5 w-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[260px] text-xs">
            {leadDesligado
              ? "O switch IA liga e desliga o Copilot para este lead. O estado da conversa (pausada, assumida) é outro controle."
              : config.ariaLabel}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {visiveis.map((a, i) => {
          // O último visível é o primário (tinta); o anterior, secundário.
          const primario = i === visiveis.length - 1 && visiveis.length > 1;
          return (
            <Button
              key={a.rotulo}
              type="button"
              size="sm"
              variant={primario && !naTinta ? "ink" : "outline"}
              disabled={isMutating}
              onClick={() => { void a.run(); }}
              className="h-8 rounded-full px-3.5 text-xs font-semibold shadow-none"
            >
              {a.rotulo}
            </Button>
          );
        })}

        {temMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Mais ações da IA"
                disabled={isMutating}
                className="h-8 w-8 rounded-full"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 text-sm">
              {noMenu.map((a) => (
                <DropdownMenuItem key={a.rotulo} onSelect={() => { void a.run(); }}>
                  <a.icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  {a.rotulo}
                </DropdownMenuItem>
              ))}
              {onOpenTimeline && (
                <>
                  {noMenu.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem onSelect={onOpenTimeline} className="text-muted-foreground">
                    <Clock className="mr-2 h-3.5 w-3.5" aria-hidden />
                    Ver histórico da IA
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {humanPaused && humanPausedUntil && onReactivateCopilot && (
          <HumanPauseBadge
            pausedUntil={humanPausedUntil}
            onReactivate={onReactivateCopilot}
            isReactivating={isReactivating ?? false}
          />
        )}

        <span className={cn("mx-1 hidden h-5 w-px sm:block", naTinta ? "bg-tinta-line" : "bg-foreground/15")} aria-hidden />

        {/* O switch do LEAD — outro conceito, mantido à direita (D3). */}
        <label
          className={cn(
            "flex cursor-pointer items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1.5",
            naTinta ? "bg-white/10" : "bg-card/70 shadow-relevo",
          )}
        >
          <Bot className="h-3.5 w-3.5 opacity-70" aria-hidden />
          <span className="text-[11px] font-bold">IA</span>
          <Switch
            checked={!switchDesligado}
            onCheckedChange={(checked) => {
              if (humanoConduzindo) return;
              onToggleAi(checked);
            }}
            disabled={toggleAiPending || humanoConduzindo}
            aria-label="Copilot ligado para este lead"
          />
        </label>
      </div>
    </div>
  );
}
