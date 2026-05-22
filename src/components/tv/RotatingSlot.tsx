import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTVPeriod } from "@/contexts/TVPeriodContext";

interface RotatingSlotProps {
  panels: { id: string; render: () => React.ReactNode }[];
}

/**
 * Alterna entre painéis sincronizado com o tick do período rotativo.
 * Cada vez que o período troca, avança pro próximo painel.
 */
export function RotatingSlot({ panels }: RotatingSlotProps) {
  const { period } = useTVPeriod();
  const [idx, setIdx] = useState(0);

  // Avança quando period muda
  useEffect(() => {
    setIdx((prev) => (prev + 1) % panels.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const current = panels[idx];

  return (
    <div className="relative h-full w-full">
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0"
        >
          {current.render()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
