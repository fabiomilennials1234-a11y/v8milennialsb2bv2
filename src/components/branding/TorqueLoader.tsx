import { motion, AnimatePresence } from "framer-motion";
import torqueLogoDark from "@/assets/torque-logo-dark.png";
import torqueLogo from "@/assets/torque-logo.png";

/**
 * TorqueLoader — Branded loading screen with the real Torque logo.
 *
 * Uses the actual brand PNG (dark/light variant) with a smooth
 * fade-in on mount and fade-out on unmount via AnimatePresence.
 * A subtle pulse keeps it alive without being distracting.
 *
 * Variants:
 *  - "full"   → full-screen (auth gate, subscription check)
 *  - "inline" → compact (suspense fallback)
 */

interface TorqueLoaderProps {
  message?: string;
  variant?: "full" | "inline";
}

export function TorqueLoader({ message, variant = "full" }: TorqueLoaderProps) {
  const isFullScreen = variant === "full";

  return (
    <AnimatePresence>
      <motion.div
        key="torque-loader"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        className={
          isFullScreen
            ? "min-h-screen flex items-center justify-center bg-background"
            : "flex items-center justify-center min-h-[60vh]"
        }
      >
        <div className="flex flex-col items-center gap-6">
          {/* Real Torque logo with gentle pulse */}
          <motion.img
            src={torqueLogoDark}
            alt="Torque"
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="dark:hidden"
            style={{ height: isFullScreen ? 48 : 32, width: "auto" }}
          />
          <motion.img
            src={torqueLogo}
            alt=""
            aria-hidden="true"
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="hidden dark:block"
            style={{ height: isFullScreen ? 48 : 32, width: "auto" }}
          />

          {/* Optional status message */}
          {message && isFullScreen && (
            <p className="text-[11px] tracking-[0.15em] uppercase text-muted-foreground/50 font-medium">
              {message}
            </p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
