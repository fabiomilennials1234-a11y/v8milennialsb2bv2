/**
 * MobileChatLayout — layout 2-estado para viewport <780px.
 *
 * Onda 3.2 — Sprint 3.2.2
 *
 * Contrato de props idêntico ao ChatShell — o consumer (ChatShellWithContext)
 * troca entre os dois via useChatViewport sem alterar a camada de dados.
 *
 * Estado 1 (selectedPhone === null): renderiza `list` full-width
 * Estado 2 (selectedPhone !== null): renderiza `view` + back button
 *
 * ContextPanel exposto via Drawer (vaul) — botão "Ver lead" no header móbile.
 * Drag horizontal no estado 2 → swipe-back (framer-motion).
 *
 * prefers-reduced-motion: gestures e AnimatePresence respeitam via variante.
 */

import { useState, useCallback } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ChevronLeft, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import type { ChatShellProps } from "./ChatShell";

// ─── Swipe-back threshold ─────────────────────────────────────────────────────

const SWIPE_OFFSET_THRESHOLD = 80;   // px deslocamento horizontal
const SWIPE_VELOCITY_THRESHOLD = 300; // px/s velocidade

// ─── Variantes de animação (respeita prefers-reduced-motion via CSS) ──────────

const slideVariants = {
  // Lista: entrada da esquerda, saída para esquerda
  listEnter:  { x: "-100%", opacity: 0 },
  listCenter: { x: 0,       opacity: 1 },
  listExit:   { x: "-100%", opacity: 0 },
  // Chat: entrada da direita, saída para direita
  chatEnter:  { x: "100%",  opacity: 0 },
  chatCenter: { x: 0,       opacity: 1 },
  chatExit:   { x: "100%",  opacity: 0 },
};

const TRANSITION = { duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] as const };

// ─── Componente ────────────────────────────────────────────────────────────────

export function MobileChatLayout({
  list,
  view,
  context,
  selectedPhone,
  onBack,
}: ChatShellProps) {
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const dragControls = useDragControls();

  const handleDragEnd = useCallback(
    (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
      if (
        info.offset.x > SWIPE_OFFSET_THRESHOLD &&
        info.velocity.x > SWIPE_VELOCITY_THRESHOLD
      ) {
        onBack();
      }
    },
    [onBack],
  );

  const hasContext = context !== null && context !== undefined;
  const inChat = selectedPhone !== null;

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background">
      <AnimatePresence mode="wait" initial={false}>
        {!inChat ? (
          /* ── Estado 1: lista full-width ─────────────────────────────────── */
          <motion.div
            key="list"
            className="absolute inset-0 flex flex-col"
            initial={slideVariants.listEnter}
            animate={slideVariants.listCenter}
            exit={slideVariants.listExit}
            transition={TRANSITION}
          >
            {list}
          </motion.div>
        ) : (
          /* ── Estado 2: chat com swipe-back ──────────────────────────────── */
          <motion.div
            key="chat"
            className="absolute inset-0 flex flex-col"
            initial={slideVariants.chatEnter}
            animate={slideVariants.chatCenter}
            exit={slideVariants.chatExit}
            transition={TRANSITION}
            drag="x"
            dragControls={dragControls}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.2 }}
            onDragEnd={handleDragEnd}
          >
            {/* Back button + "Ver lead" injetados acima do view */}
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-2 border-b border-border bg-background shrink-0",
              )}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="h-8 w-8 p-0 rounded-full"
                aria-label="Voltar para lista"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <span className="flex-1" />
              {hasContext && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setContextDrawerOpen(true)}
                  className="h-8 gap-1.5 px-3 text-xs font-medium"
                  aria-label="Ver dados do lead"
                >
                  <User className="w-3.5 h-3.5" />
                  Ver lead
                </Button>
              )}
            </div>

            {/* Área de chat */}
            <div
              className="flex-1 flex flex-col min-h-0 overflow-hidden"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
            >
              {view}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Drawer do ContextPanel (vaul) ─────────────────────────────────── */}
      {hasContext && (
        <Drawer
          open={contextDrawerOpen}
          onOpenChange={setContextDrawerOpen}
          shouldScaleBackground={false}
        >
          <DrawerContent className="max-h-[92dvh]">
            <DrawerHeader className="pb-2">
              <DrawerTitle className="text-sm font-semibold">Dados do lead</DrawerTitle>
            </DrawerHeader>
            <div className="overflow-y-auto flex-1 px-4 pb-6">
              {context}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
