/**
 * ChatBubbleFab — Floating Action Button do Chat Bubble Kanban.
 *
 * Idle: pílula horizontal (Intercom/Crisp launcher pattern) com ícone + label
 * "Conversas" + badge unread inline. Mais visível em workspace de Pipe denso,
 * comunica intent imediatamente sem depender de affordance circular pura.
 *
 * Open: colapsa para círculo 56×56 com X — feedback claro de "fechar".
 *
 * Diferenciação do OraculoFloatingButton (gradient roxo, círculo simples,
 * pulse infinito): aqui é gold + pílula esticada + sem pulse contínuo.
 *
 * Hover: scale 1.04 + cubic-bezier(0.16, 1, 0.3, 1), 150ms.
 * Tap: scale 0.96, 100ms.
 * Layout transition (pílula ↔ círculo): framer-motion `layout` 280ms.
 */
import { memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, X } from "lucide-react";
import { ChatBubbleBadge } from "./ChatBubbleBadge";

interface ChatBubbleFabProps {
  isOpen: boolean;
  unreadTotal: number;
  onClick: () => void;
}

function ChatBubbleFabBase({ isOpen, unreadTotal, onClick }: ChatBubbleFabProps) {
  const ariaLabel = isOpen
    ? "Fechar conversas"
    : unreadTotal > 0
      ? `Conversas no WhatsApp · ${unreadTotal} não lida${unreadTotal > 1 ? "s" : ""}`
      : "Conversas no WhatsApp";
  const tooltip = isOpen ? "Fechar" : "Conversas no WhatsApp";

  return (
    <motion.button
      type="button"
      onClick={onClick}
      layout
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      transition={{
        layout: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
        scale: { type: "tween", duration: 0.15, ease: [0.16, 1, 0.3, 1] },
      }}
      style={{
        background: "var(--gradient-primary)",
        boxShadow: "var(--shadow-gold)",
      }}
      className={
        isOpen
          ? // Estado open: círculo compact 56×56
            `fixed bottom-6 right-6 z-40
             w-14 h-14 rounded-full
             flex items-center justify-center
             text-primary-foreground
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
             transition-shadow duration-200
             motion-reduce:transition-none`
          : // Estado idle: pílula horizontal — chama atenção
            `fixed bottom-6 right-6 z-40
             h-14 px-5 rounded-full
             flex items-center gap-2.5
             text-primary-foreground font-semibold text-[13px] tracking-tight
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
             transition-shadow duration-200
             hover:shadow-[0_14px_40px_-10px_hsl(47_100%_50%/0.45)]
             motion-reduce:transition-none`
      }
      aria-label={ariaLabel}
      aria-expanded={isOpen}
      aria-controls="chat-bubble-panel"
      title={tooltip}
      data-testid="chat-bubble-fab"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isOpen ? (
          <motion.span
            key="x"
            initial={{ scale: 0.7, opacity: 0, rotate: -45 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.7, opacity: 0, rotate: 45 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="motion-reduce:!duration-0"
          >
            <X className="w-6 h-6" aria-hidden strokeWidth={2.4} />
          </motion.span>
        ) : (
          <motion.span
            key="msg"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center gap-2.5 motion-reduce:!duration-0"
          >
            <MessageCircle className="w-5 h-5 shrink-0" aria-hidden strokeWidth={2.4} />
            <motion.span layout="position" className="whitespace-nowrap">
              Conversas
            </motion.span>
            {unreadTotal > 0 && (
              <motion.span
                key={unreadTotal}
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.18, 1] }}
                transition={{
                  duration: 0.5,
                  times: [0, 0.65, 1],
                  ease: [0.175, 0.885, 0.32, 1.275],
                }}
                className="
                  inline-flex items-center justify-center
                  min-w-[20px] h-5 px-1.5
                  rounded-full
                  bg-background text-primary
                  text-[11px] font-bold tabular-nums leading-none
                  ring-1 ring-primary-foreground/15
                  motion-reduce:!animate-none
                "
                aria-hidden
              >
                {unreadTotal > 99 ? "99+" : unreadTotal}
              </motion.span>
            )}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Badge externo apenas no estado open (caso reabra c/ unread acumulado) */}
      {isOpen && <ChatBubbleBadge count={unreadTotal} />}
    </motion.button>
  );
}

// memo evita re-render do FAB durante drag-and-drop do Kanban quando props
// (isOpen, unreadTotal, onClick) não mudam. onClick vem do Provider via
// useCallback, garantindo identidade estável.
export const ChatBubbleFab = memo(ChatBubbleFabBase);
