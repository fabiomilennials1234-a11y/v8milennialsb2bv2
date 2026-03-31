import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import torqueLogo from "@/assets/torque-logo.png";

// ─── CSS confetti keyframes (no external library) ─────────────────────────────

const CONFETTI_COLORS = [
  "hsl(31 85% 53%)",
  "hsl(47 100% 50%)",
  "hsl(142 71% 45%)",
  "hsl(217 91% 60%)",
  "hsl(280 68% 60%)",
  "hsl(0 84% 60%)",
];

function ConfettiPiece({ index }: { index: number }) {
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
  const left = 10 + Math.random() * 80;
  const delay = Math.random() * 0.8;
  const duration = 2.5 + Math.random() * 2;
  const rotation = Math.random() * 360;
  const size = 6 + Math.random() * 6;

  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        left: `${left}%`,
        top: -20,
        width: size,
        height: size * 0.5,
        backgroundColor: color,
        borderRadius: 1,
        transform: `rotate(${rotation}deg)`,
      }}
      initial={{ y: -20, opacity: 1, rotate: rotation }}
      animate={{
        y: [0, window.innerHeight * 0.7 + Math.random() * 200],
        x: [0, (Math.random() - 0.5) * 200],
        rotate: [rotation, rotation + 360 * (Math.random() > 0.5 ? 1 : -1)],
        opacity: [1, 1, 0],
      }}
      transition={{
        duration,
        delay,
        ease: "easeIn",
      }}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CheckoutSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showConfetti, setShowConfetti] = useState(true);

  const planName =
    (location.state as any)?.plan_name ?? "Torque";
  const orgName =
    (location.state as any)?.org_name ?? "sua organizacao";

  // Auto-dismiss confetti after 5 seconds
  useEffect(() => {
    const timeout = setTimeout(() => setShowConfetti(false), 5000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Confetti layer */}
      {showConfetti && (
        <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
          {Array.from({ length: 50 }).map((_, i) => (
            <ConfettiPiece key={i} index={i} />
          ))}
        </div>
      )}

      {/* Ambient glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, hsl(31 85% 53% / 0.08) 0%, transparent 60%)",
        }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-center h-16 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <img
          src={torqueLogo}
          alt="Torque CRM"
          className="h-7 object-contain"
        />
      </header>

      {/* Content */}
      <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-64px)] px-4">
        <motion.div
          className="max-w-md w-full text-center"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          {/* Success icon */}
          <motion.div
            className="mx-auto mb-6"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{
              type: "spring",
              stiffness: 200,
              damping: 15,
              delay: 0.4,
            }}
          >
            <div className="relative inline-flex">
              <div className="h-20 w-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400" />
              </div>
              <motion.div
                className="absolute -top-1 -right-1"
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.7, type: "spring" }}
              >
                <Sparkles className="h-6 w-6 text-primary" />
              </motion.div>
            </div>
          </motion.div>

          {/* Heading */}
          <motion.h1
            className="text-3xl font-black text-foreground mb-3"
            style={{ letterSpacing: "-0.03em" }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            Organizacao criada
            <br />
            com sucesso!
          </motion.h1>

          {/* Summary */}
          <motion.div
            className="rounded-xl bg-card border border-border px-5 py-4 mb-8 text-left space-y-2"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65 }}
          >
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Plano</span>
              <span className="font-semibold text-foreground">{planName}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Organizacao</span>
              <span className="font-semibold text-foreground">{orgName}</span>
            </div>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
          >
            <Button
              onClick={() => navigate("/", { replace: true })}
              className="h-13 px-8 gradient-primary gradient-primary-hover text-white font-semibold border-0 text-sm"
              style={{ height: 52 }}
            >
              Ir para o Dashboard
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </motion.div>

          <motion.p
            className="text-xs text-muted-foreground/40 mt-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
          >
            Sua equipe ja pode comecar a usar o Torque CRM.
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
