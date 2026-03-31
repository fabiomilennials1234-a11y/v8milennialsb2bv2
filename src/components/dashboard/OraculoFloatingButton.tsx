import { memo } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface Props {
  remaining: number;
  isOpen: boolean;
  onClick: () => void;
}

function OraculoFloatingButtonBase({ remaining, isOpen, onClick }: Props) {
  return (
    <motion.button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg flex items-center justify-center hover:shadow-purple-500/25 hover:shadow-xl transition-shadow"
      animate={{
        scale: isOpen ? 0.9 : 1,
        rotate: isOpen ? 45 : 0,
      }}
      whileHover={{ scale: isOpen ? 0.9 : 1.05 }}
      whileTap={{ scale: 0.95 }}
      title="Oráculo Comercial"
    >
      <Sparkles className="w-6 h-6" />

      {/* Pulse glow */}
      {!isOpen && (
        <motion.div
          className="absolute inset-0 rounded-full bg-purple-400"
          animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
        />
      )}

      {/* Remaining badge */}
      {!isOpen && remaining > 0 && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-1 -right-1 w-5 h-5 bg-white text-purple-600 rounded-full text-xs font-bold flex items-center justify-center shadow-sm"
        >
          {remaining}
        </motion.div>
      )}

      {/* Empty badge when limit reached */}
      {!isOpen && remaining === 0 && (
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-muted text-muted-foreground rounded-full text-xs font-bold flex items-center justify-center shadow-sm">
          0
        </div>
      )}
    </motion.button>
  );
}

export const OraculoFloatingButton = memo(OraculoFloatingButtonBase);
