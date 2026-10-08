import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";

type Theme = "light" | "dark" | "system";

type ThemeTransitionContextValue = {
  requestThemeChange: (newTheme: Theme) => void;
};

const ThemeTransitionContext = createContext<ThemeTransitionContextValue | null>(null);

const THEME_BG_SOLID: Record<"light" | "dark", string> = {
  light: "hsl(45 20% 98%)",
  dark: "hsl(36 20% 12%)",
};

const DURATION_MS = 1400;
const DURATION_S = DURATION_MS / 1000;
const RADIUS_END = 280;
const BODY_CLASS = "theme-transitioning";
/* Aplica o tema um pouco antes do fim para suavizar a mudança para o claro */
const THEME_APPLY_AT_MS = 900;

export function ThemeTransitionProvider({ children }: { children: ReactNode }) {
  const { setTheme } = useTheme();
  const [overlay, setOverlay] = useState<{ theme: "light" | "dark"; key: number } | null>(null);
  const themeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (themeTimerRef.current) {
      clearTimeout(themeTimerRef.current);
      themeTimerRef.current = null;
    }
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearTimers();
    document.body.classList.remove(BODY_CLASS);
  }, [clearTimers]);

  useEffect(() => {
    if (overlay) document.body.classList.add(BODY_CLASS);
    else document.body.classList.remove(BODY_CLASS);
  }, [overlay]);

  const requestThemeChange = useCallback(
    (newTheme: Theme) => {
      const resolved: "light" | "dark" =
        newTheme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : newTheme;

      setOverlay({ theme: resolved, key: Date.now() });
      clearTimers();

      const applyTheme = () => {
        setTheme(newTheme);
        const root = document.documentElement;
        if (newTheme === "light") root.classList.remove("dark");
        else if (newTheme === "dark") root.classList.add("dark");
        else {
          if (window.matchMedia("(prefers-color-scheme: dark)").matches) root.classList.add("dark");
          else root.classList.remove("dark");
        }
      };

      themeTimerRef.current = setTimeout(applyTheme, THEME_APPLY_AT_MS);
      endTimerRef.current = setTimeout(() => {
        document.body.classList.remove(BODY_CLASS);
        setOverlay(null);
        clearTimers();
      }, DURATION_MS);
    },
    [setTheme, clearTimers]
  );

  return (
    <ThemeTransitionContext.Provider value={{ requestThemeChange }}>
      <AnimatePresence>
        {overlay && (
          <motion.div
            key={overlay.key}
            className="fixed inset-0 z-0 pointer-events-none"
            initial={{ "--r": 0 } as React.CSSProperties}
            animate={{ "--r": RADIUS_END } as React.CSSProperties}
            exit={{ "--r": RADIUS_END } as React.CSSProperties}
            transition={{
              duration: DURATION_S,
              ease: [0.22, 0.61, 0.36, 1],
            }}
            style={{
              background: `radial-gradient(
                circle calc(var(--r) * 1vmax) at 100% 100%,
                ${THEME_BG_SOLID[overlay.theme]} 0%,
                ${THEME_BG_SOLID[overlay.theme]} 58%,
                transparent 72%
              )`,
            } as React.CSSProperties}
          />
        )}
      </AnimatePresence>
      <div className="relative z-[1] min-h-screen">
        {children}
      </div>
    </ThemeTransitionContext.Provider>
  );
}

export function useThemeTransition(): ThemeTransitionContextValue | null {
  return useContext(ThemeTransitionContext);
}
