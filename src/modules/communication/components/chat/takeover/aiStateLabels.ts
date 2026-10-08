/**
 * aiStateLabels — configuração visual por estado FSM de takeover IA↔humano.
 *
 * C29: 5 estados com label, ícone lucide, classes Tailwind e aria-label.
 * V5 (como no mockup): IA ativa = ouro suave · pausada = neutro · aguardando
 * você = alerta · humano conduzindo = tinta · retomando = azul. Só tokens.
 * Consumido por TakeoverControls e AITimeline.
 */
import { Bot, Pause, Hand, User, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AiTakeoverState } from "@/modules/communication/lib/chat-types";

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
    pillClasses: "bg-primary-soft text-primary-soft-foreground border-transparent",
    ariaLabel: "IA está respondendo automaticamente",
  },
  AI_PAUSED_MANUAL: {
    label: "IA pausada",
    icon: Pause,
    pillClasses: "bg-muted text-muted-foreground border-transparent",
    ariaLabel: "IA pausada manualmente",
  },
  WAITING_HUMAN: {
    label: "Aguardando você",
    icon: Hand,
    pillClasses: "bg-warning/15 text-warning-strong border-warning/30",
    ariaLabel: "IA pediu intervenção humana — aguardando operador",
  },
  HUMAN_ACTIVE: {
    label: "Você assumiu",
    icon: User,
    pillClasses: "bg-tinta text-tinta-foreground border-transparent dark:bg-foreground dark:text-background",
    ariaLabel: "Operador humano está controlando a conversa",
  },
  HANDOFF_BACK: {
    label: "Retomando IA",
    icon: RefreshCw,
    pillClasses: "bg-insights/10 text-insights border-insights/25",
    ariaLabel: "Conversa sendo transferida de volta para a IA",
  },
};
