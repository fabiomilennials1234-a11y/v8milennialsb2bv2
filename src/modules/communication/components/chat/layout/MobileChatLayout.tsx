/**
 * MobileChatLayout — fullscreen 2-state layout for mobile chat.
 *
 * State 1 (selectedPhone === null): list full-width, bottom nav visible.
 * State 2 (selectedPhone !== null): thread full-width, navbar + bottom nav hidden.
 *
 * Slide horizontal animation (Framer Motion). Swipe-back gesture on thread.
 * Wires MobileChatContext.setChatThreadOpen for navbar/bottom nav hiding.
 */

import { useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMobileChatContext } from "@/contexts/MobileChatContext";
import { useKeyboardOffset } from "@/hooks/use-keyboard-offset";
import type { ChatShellProps } from "./ChatShell";

// ─── Swipe-back threshold ─────────────────────────────────────────────────────

const SWIPE_OFFSET_THRESHOLD = 80;
const SWIPE_VELOCITY_THRESHOLD = 300;

// ─── Animation variants ──────────────────────────────────────────────────────

const slideVariants = {
  listEnter:  { x: "-100%", opacity: 0 },
  listCenter: { x: 0,       opacity: 1 },
  listExit:   { x: "-100%", opacity: 0 },
  chatEnter:  { x: "100%",  opacity: 0 },
  chatCenter: { x: 0,       opacity: 1 },
  chatExit:   { x: "100%",  opacity: 0 },
};

const TRANSITION = { duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] as const };

// ─── Component ────────────────────────────────────────────────────────────────

export function MobileChatLayout({
  list,
  view,
  selectedPhone,
  onBack,
}: ChatShellProps) {
  const { setChatThreadOpen } = useMobileChatContext();
  const { offset: kbOffset } = useKeyboardOffset();

  const inChat = selectedPhone !== null;

  // Sync thread state to context for navbar/bottom nav hiding
  useEffect(() => {
    setChatThreadOpen(inChat);
    return () => setChatThreadOpen(false);
  }, [inChat, setChatThreadOpen]);

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

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background">
      <AnimatePresence mode="wait" initial={false}>
        {!inChat ? (
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
          <motion.div
            key="chat"
            className="absolute inset-0 flex flex-col"
            initial={slideVariants.chatEnter}
            animate={slideVariants.chatCenter}
            exit={slideVariants.chatExit}
            transition={TRANSITION}
            drag="x"
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.2 }}
            onDragEnd={handleDragEnd}
          >
            <div
              className="flex-1 flex flex-col min-h-0 overflow-hidden"
              style={{
                paddingBottom: kbOffset > 0 ? `${kbOffset}px` : undefined,
              }}
            >
              {view}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
