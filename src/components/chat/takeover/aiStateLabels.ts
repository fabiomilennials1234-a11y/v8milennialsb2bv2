/**
 * aiStateLabels — configuração visual por estado FSM de takeover IA↔humano.
 *
 * C29: 5 estados com label, ícone lucide, classes Tailwind e aria-label.
 * Consumido por TakeoverControls e AITimeline.
 */
import { Bot, Pause, Hand, User, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AiTakeoverState } from "@/lib/chat-types";

export interface AiStateConfig {
  label: string;
  icon: LucideIcon;
  /** Classes Tailwind completas para o pill — não usar cores arbitrárias fora deste mapa */
  pillClasses: string;
  ariaLabel: string;
}

export const AI_STATE_CONFIG: Record<AiTakeoverState, AiStateConfig> = {
  AI_ACTIVE: {
    label: "IA ativa",
    icon: Bot,
    pillClasses: "bg-primary/10 text-primary border-primary/30",
    ariaLabel: "IA está respondendo automaticamente",
  },
  AI_PAUSED_MANUAL: {
    label: "IA pausada",
    icon: Pause,
    pillClasses: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    ariaLabel: "IA pausada manualmente",
  },
  WAITING_HUMAN: {
    label: "Aguardando você",
    icon: Hand,
    pillClasses: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
    ariaLabel: "IA pediu intervenção humana — aguardando operador",
  },
  HUMAN_ACTIVE: {
    label: "Você assumiu",
    icon: User,
    pillClasses: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30",
    ariaLabel: "Operador humano está controlando a conversa",
  },
  HANDOFF_BACK: {
    label: "Retomando IA",
    icon: RefreshCw,
    pillClasses: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
    ariaLabel: "Conversa sendo transferida de volta para a IA",
  },
};
