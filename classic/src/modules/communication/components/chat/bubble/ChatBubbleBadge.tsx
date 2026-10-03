/**
 * ChatBubbleBadge — pop one-shot ao incrementar (sem loop infinito).
 *
 * Linear/Vercel approach: animação é impulso curto, não estado contínuo.
 * `key={count}` força remount → AnimatePresence dispara animation entry.
 *
 * prefers-reduced-motion: troca instantânea sem pop.
 */
import { motion } from "framer-motion";

interface ChatBubbleBadgeProps {
  count: number;
}

export function ChatBubbleBadge({ count }: ChatBubbleBadgeProps) {
  if (count <= 0) return null;
  const display = count > 99 ? "99+" : String(count);

  return (
    <motion.span
      key={count}
      initial={{ scale: 0 }}
      animate={{ scale: [0, 1.15, 1] }}
      transition={{
        duration: 0.6,
        times: [0, 0.7, 1],
        ease: [0.175, 0.885, 0.32, 1.275],
      }}
      className="
        absolute -top-1 -right-1
        min-w-[18px] h-[18px] px-1.5
        rounded-full
        bg-destructive text-destructive-foreground
        text-[10px] font-bold tabular-nums leading-none
        flex items-center justify-center
        ring-2 ring-background
        motion-reduce:transition-none motion-reduce:[animation:none]
      "
      aria-hidden
    >
      {display}
    </motion.span>
  );
}
