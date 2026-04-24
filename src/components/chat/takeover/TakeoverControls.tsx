/**
 * TakeoverControls — pill + dropdown FSM de takeover IA↔humano.
 *
 * C29: 5 estados, ações condicionais por estado, motion prefers-reduced-motion.
 *
 * Props:
 *   conversationId — id da conversa (null = oculto)
 *   state          — AiTakeoverState (pode ser passado pelo pai ou interno via useTakeover)
 *   resumeMode     — AiStateResumeMode para contexto visual
 *
 * Quando conversationId for null, não renderiza nada — ChatHeader controla isso.
 */
import React, { useState } from "react";
import { ChevronDown, Bot, Pause, User, RefreshCw, Clock } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTakeover } from "@/hooks/chat/useTakeover";
import { AI_STATE_CONFIG } from "./aiStateLabels";
import type { AiTakeoverState } from "@/lib/chat-types";

// ─── prefers-reduced-motion ───────────────────────────────────────────────────

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return reduced;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TakeoverControlsProps {
  conversationId: string | null | undefined;
  /** Callback opcional para abrir AITimeline — chamado pelo item "Ver histórico da IA" */
  onOpenTimeline?: () => void;
}

// ─── Dropdown ações por estado ────────────────────────────────────────────────

function TakeoverDropdownItems({
  state,
  pauseAi,
  resumeAi,
  markHumanActive,
  markHandoffBack,
  onOpenTimeline,
}: {
  state: AiTakeoverState;
  pauseAi: (mode: "immediate" | "after_response" | "dont_resume") => Promise<void>;
  resumeAi: () => Promise<void>;
  markHumanActive: () => Promise<void>;
  markHandoffBack: () => Promise<void>;
  onOpenTimeline?: () => void;
}) {
  return (
    <>
      {state === "AI_ACTIVE" && (
        <>
          <DropdownMenuItem onSelect={() => pauseAi("immediate")}>
            <Pause className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            Pausar IA — agora
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pauseAi("after_response")}>
            <Pause className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            Pausar após resposta
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pauseAi("dont_resume")}>
            <Pause className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            Não retomar automaticamente
          </DropdownMenuItem>
        </>
      )}

      {state === "AI_PAUSED_MANUAL" && (
        <>
          <DropdownMenuItem onSelect={() => resumeAi()}>
            <Bot className="h-3.5 w-3.5 mr-2 text-primary" />
            Retomar IA
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => markHumanActive()}>
            <User className="h-3.5 w-3.5 mr-2 text-green-500" />
            Assumir conversa
          </DropdownMenuItem>
        </>
      )}

      {state === "WAITING_HUMAN" && (
        <>
          <DropdownMenuItem onSelect={() => markHumanActive()}>
            <User className="h-3.5 w-3.5 mr-2 text-green-500" />
            Assumir conversa
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => resumeAi()}>
            <Bot className="h-3.5 w-3.5 mr-2 text-primary" />
            Descartar handoff
          </DropdownMenuItem>
        </>
      )}

      {state === "HUMAN_ACTIVE" && (
        <>
          <DropdownMenuItem onSelect={() => markHandoffBack()}>
            <RefreshCw className="h-3.5 w-3.5 mr-2 text-blue-500" />
            Devolver para IA
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pauseAi("dont_resume")}>
            <Pause className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            Pausar IA permanente
          </DropdownMenuItem>
        </>
      )}

      {state === "HANDOFF_BACK" && (
        <>
          <DropdownMenuItem onSelect={() => resumeAi()}>
            <Bot className="h-3.5 w-3.5 mr-2 text-primary" />
            Retomar IA agora
          </DropdownMenuItem>
        </>
      )}

      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={onOpenTimeline}
        className="text-muted-foreground"
      >
        <Clock className="h-3.5 w-3.5 mr-2" />
        Ver histórico da IA
      </DropdownMenuItem>
    </>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function TakeoverControls({
  conversationId,
  onOpenTimeline,
}: TakeoverControlsProps) {
  const prefersReduced = usePrefersReducedMotion();
  const [isHovered, setIsHovered] = useState(false);

  const {
    state,
    resumeMode,
    isMutating,
    pauseAi,
    resumeAi,
    markWaitingHuman,
    markHumanActive,
    markHandoffBack,
  } = useTakeover(conversationId);

  if (!conversationId) return null;

  const { label, icon: Icon, pillClasses, ariaLabel } = AI_STATE_CONFIG[state];

  const pillContent = (
    <div className="flex items-center gap-1.5">
      {isMutating ? (
        <span
          className="h-3 w-3 shrink-0 rounded-full border-2 border-current/30 border-t-current animate-spin"
          aria-hidden
        />
      ) : (
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
      )}
      <span>{label}</span>
    </div>
  );

  return (
    <div role="group" aria-label={ariaLabel}>
      {/* Aria live — screen reader anuncia mudanças de estado */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {ariaLabel}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel}
            aria-haspopup="menu"
            className={cn(
              "inline-flex items-center gap-1.5",
              "h-7 pl-2 pr-1.5 rounded-full",
              "border text-[11px] font-medium",
              "transition-all duration-150",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "focus-visible:ring-offset-background",
              pillClasses,
            )}
            style={{
              filter: isHovered ? "brightness(1.05)" : undefined,
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={state}
                className="inline-flex items-center gap-1.5"
                initial={prefersReduced ? { opacity: 0 } : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={prefersReduced ? { opacity: 0 } : { opacity: 0 }}
                transition={{ duration: prefersReduced ? 0 : 0.15 }}
              >
                {pillContent}
              </motion.span>
            </AnimatePresence>
            <ChevronDown
              className="h-3 w-3 shrink-0 transition-transform duration-150 ml-0.5"
              aria-hidden
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-52 text-sm">
          <TakeoverDropdownItems
            state={state}
            pauseAi={pauseAi}
            resumeAi={resumeAi}
            markHumanActive={markHumanActive}
            markHandoffBack={markHandoffBack}
            onOpenTimeline={onOpenTimeline}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
