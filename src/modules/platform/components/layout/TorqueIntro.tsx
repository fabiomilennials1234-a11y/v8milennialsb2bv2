import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import torqueIcon from "@/assets/torque-icon.png";
import torqueLogo from "@/assets/torque-logo.png";
import torqueLogoDark from "@/assets/torque-logo-dark.png";

/**
 * TorqueIntro — abertura do app.
 *
 * O símbolo (`torque-icon.png`) fica separado para poder GIRAR; o wordmark
 * "TORQUE" é recortado do logo real (fonte original preservada) deslocando o
 * hexágono para fora do recorte. Sequência: entra com glow → revela o nome →
 * segura → o nome retrai "entrando no símbolo" enquanto o símbolo dá uma girada
 * (360°) → some e entra no sistema.
 *
 * Toca **uma vez por carregamento** (flag de módulo sobrevive a remounts do
 * layout, mas zera num reload / login novo).
 */
let introHasPlayed = false;

// Rotas públicas onde a abertura NÃO deve tocar (landing/login/etc.).
const PUBLIC_PREFIXES = [
  "/landing",
  "/auth",
  "/signup",
  "/pricing",
  "/privacidade",
  "/reset-password",
];
function isPublicPath(p: string) {
  return PUBLIC_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
}

type Phase = "enter" | "collapse" | "exit";

// Recorte do wordmark a h-16 (fonte original do logo). WORDMARK_OFFSET empurra o
// hexágono do logo para fora do recorte, deixando só "TORQUE".
const LOGO_H = 64; // h-16
const FULL_W = LOGO_H * (2095 / 331); // largura do logo completo nessa altura
const WORDMARK_OFFSET = FULL_W * 0.178; // esconde o hexágono
const WORDMARK_W = FULL_W - WORDMARK_OFFSET;

export function TorqueIntro() {
  const { resolvedTheme } = useTheme();
  const logoSrc = resolvedTheme === "light" ? torqueLogoDark : torqueLogo;

  const shouldPlay =
    !introHasPlayed &&
    typeof window !== "undefined" &&
    !isPublicPath(window.location.pathname);

  const [show, setShow] = useState(shouldPlay);
  const [phase, setPhase] = useState<Phase>("enter");

  useEffect(() => {
    if (!shouldPlay) return;
    introHasPlayed = true;

    const t1 = window.setTimeout(() => setPhase("collapse"), 1700);
    const t2 = window.setTimeout(() => setPhase("exit"), 2600);
    const t3 = window.setTimeout(() => setShow(false), 3250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameOpen = phase === "enter";
  const spinning = phase === "collapse" || phase === "exit";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="torque-intro"
          initial={{ opacity: 1 }}
          animate={{ opacity: phase === "exit" ? 0 : 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: "easeInOut" }}
          className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-background"
        >
          {/* Glow dourado suave */}
          <motion.div
            aria-hidden
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: phase === "exit" ? 0 : 0.5, scale: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="pointer-events-none absolute h-[320px] w-[320px] rounded-full bg-primary/25 blur-[90px]"
          />

          <motion.div
            className="relative flex items-center"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: phase === "exit" ? 1.12 : 1, opacity: phase === "exit" ? 0 : 1 }}
            transition={{ type: "spring", stiffness: 150, damping: 16, delay: 0.1 }}
          >
            {/* Símbolo — gira ao colapsar (letras "entrando") */}
            <motion.img
              src={torqueIcon}
              alt="Torque"
              animate={{ rotate: spinning ? 360 : 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="h-16 w-16 object-contain drop-shadow-[0_0_24px_hsl(var(--primary)/0.55)]"
            />

            {/* Wordmark — recortado do logo (fonte original) */}
            <motion.div
              className="overflow-hidden"
              initial={{ maxWidth: 0, opacity: 0, marginLeft: 0 }}
              animate={{
                maxWidth: nameOpen ? WORDMARK_W : 0,
                opacity: nameOpen ? 1 : 0,
                marginLeft: nameOpen ? 14 : 0,
              }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: nameOpen ? 0.45 : 0 }}
            >
              <img
                src={logoSrc}
                alt=""
                aria-hidden
                style={{ marginLeft: -WORDMARK_OFFSET }}
                className="h-16 max-w-none object-contain object-left"
              />
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
