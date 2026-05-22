import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  type TVPeriod,
  type TVPeriodRange,
  TV_PERIODS,
  getPeriodLabel,
  getPeriodRange,
  nextPeriod,
} from "@/lib/tv-periods";

interface TVPeriodContextValue {
  period: TVPeriod;
  label: string;
  range: TVPeriodRange;
  next: TVPeriod;
  /** Progresso 0..1 até a próxima troca (pra ring/progress UI). */
  progress: number;
  /** Segundos restantes até a próxima troca. */
  secondsLeft: number;
}

const TVPeriodContext = createContext<TVPeriodContextValue | null>(null);

const CYCLE_MS = 12_000;
const TICK_MS = 200;

export function TVPeriodProvider({ children, initialPeriod = "hoje" }: { children: React.ReactNode; initialPeriod?: TVPeriod }) {
  const [period, setPeriod] = useState<TVPeriod>(initialPeriod);
  const [tick, setTick] = useState(0);
  const [cycleStart, setCycleStart] = useState(() => Date.now());

  // Tick interno pra animar progress ring e recomputar range
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Cycle trocador
  useEffect(() => {
    const id = setInterval(() => {
      setPeriod((p) => nextPeriod(p));
      setCycleStart(Date.now());
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  const value = useMemo<TVPeriodContextValue>(() => {
    const elapsed = Date.now() - cycleStart;
    const progress = Math.min(elapsed / CYCLE_MS, 1);
    const secondsLeft = Math.max(0, Math.ceil((CYCLE_MS - elapsed) / 1000));
    return {
      period,
      label: getPeriodLabel(period),
      range: getPeriodRange(period),
      next: nextPeriod(period),
      progress,
      secondsLeft,
    };
    // tick é dependência intencional pra recomputar progress/secondsLeft
  }, [period, cycleStart, tick]);

  return <TVPeriodContext.Provider value={value}>{children}</TVPeriodContext.Provider>;
}

export function useTVPeriod(): TVPeriodContextValue {
  const ctx = useContext(TVPeriodContext);
  if (!ctx) {
    throw new Error("useTVPeriod deve ser usado dentro de <TVPeriodProvider>");
  }
  return ctx;
}

export { TV_PERIODS };
export type { TVPeriod };
