import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Star, Sparkles, Trophy, Zap, PartyPopper } from "lucide-react";

interface CelebrationEffectProps {
  show: boolean;
  onComplete?: () => void;
  message?: string;
  type?: "confetti" | "stars" | "trophy";
}

// Confete é decoração, não estado — mas hex cru não tem par no escuro. A paleta
// sai dos tokens do sistema (ouro, verde, azul, prata, âmbar, vermelho).
const CONFETTI_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--insights))",
  "hsl(var(--silver))",
  "hsl(var(--destructive))",
  "hsl(var(--warning))",
  "hsl(var(--gold-soft))",
];

const particles = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  delay: Math.random() * 0.5,
  duration: 1 + Math.random() * 2,
  size: 8 + Math.random() * 16,
  rotation: Math.random() * 360,
}));

export function CelebrationEffect({ 
  show, 
  onComplete,
  message = "Parabéns!",
  type = "confetti" 
}: CelebrationEffectProps) {
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (show) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        onComplete?.();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 pointer-events-none z-50 overflow-hidden"
        >
          {/* Particles */}
          {particles.map((particle) => (
            <motion.div
              key={particle.id}
              initial={{
                x: `${particle.x}vw`,
                y: -20,
                rotate: 0,
                scale: 0,
              }}
              animate={{
                y: "110vh",
                rotate: particle.rotation + 360,
                scale: [0, 1, 1, 0.5],
              }}
              transition={{
                duration: particle.duration,
                delay: particle.delay,
                ease: "linear",
              }}
              className="absolute"
              style={{
                width: particle.size,
                height: particle.size,
              }}
            >
              {type === "confetti" && (
                <div
                  className="w-full h-full rounded-sm"
                  style={{
                    backgroundColor: CONFETTI_COLORS[particle.id % CONFETTI_COLORS.length],
                  }}
                />
              )}
              {type === "stars" && (
                <Star className="w-full h-full text-primary fill-primary" />
              )}
            </motion.div>
          ))}

          {/* Center Message */}
          <motion.div
            initial={{ scale: 0, y: 50 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0, y: -50 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
          >
            <div className="rounded-panel border border-card-border bg-card p-8 text-center text-card-foreground shadow-relevo-alto">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.2, 1] }}
                transition={{ delay: 0.2 }}
                className="w-20 h-20 mx-auto mb-4 grid place-items-center rounded-full bg-primary text-primary-foreground shadow-brilho-ouro"
              >
                {type === "trophy" ? (
                  <Trophy className="w-10 h-10" />
                ) : (
                  <PartyPopper className="w-10 h-10" />
                )}
              </motion.div>
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-2xl font-extrabold tracking-[-0.035em] text-foreground"
              >
                {message}
              </motion.h2>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="flex items-center justify-center gap-1 mt-2"
              >
                <Sparkles className="w-4 h-4 text-primary-soft-foreground" />
                <span className="text-sm text-muted-foreground">Continue assim!</span>
                <Sparkles className="w-4 h-4 text-primary-soft-foreground" />
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Confetti({ count = 50 }: { count?: number }) {
  const colors = CONFETTI_COLORS;
  
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          initial={{
            x: `${Math.random() * 100}%`,
            y: -20,
            rotate: 0,
          }}
          animate={{
            y: "100%",
            rotate: 360,
          }}
          transition={{
            duration: 2 + Math.random() * 2,
            delay: Math.random(),
            repeat: Infinity,
            ease: "linear",
          }}
          className="absolute w-2 h-3 rounded-sm"
          style={{
            backgroundColor: colors[i % colors.length],
          }}
        />
      ))}
    </div>
  );
}
