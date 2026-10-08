import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface ScrollToBottomFabProps {
  visible: boolean;
  count: number;
  onClick: () => void;
}

export function ScrollToBottomFab({ visible, count, onClick }: ScrollToBottomFabProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={onClick}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className={cn(
            "absolute bottom-24 right-6 z-20",
            "flex items-center gap-2 px-3 py-2",
            "rounded-full bg-primary text-primary-foreground shadow-lg",
            "text-xs font-medium",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
            "hover:brightness-105 transition-[filter]"
          )}
          aria-label={count > 0 ? `${count} ${count > 1 ? "novas mensagens" : "nova mensagem"}` : "Ir para o final"}
        >
          <ArrowDown className="w-3.5 h-3.5" />
          {count > 0 && (
            <span className="tabular-nums">
              {count} nova{count > 1 ? "s" : ""}
            </span>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
