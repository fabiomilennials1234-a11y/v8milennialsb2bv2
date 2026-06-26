import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL, formatInt } from "./lib/format";

interface CacBandGaugeProps {
  cacAtual: number | null;
  cacMinimo: number | null;
  cacIdeal: number | null;
  cacMaximo: number | null;
  despesasTotais: number;
  numVendas: number;
}

type Zone = "success" | "warning" | "destructive";

function zoneOf(value: number, ideal: number, maximo: number): Zone {
  if (value > maximo) return "destructive";
  if (value >= ideal) return "warning";
  return "success";
}

const CAP_BG: Record<Zone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/**
 * CAC em 3 bandas (DESIGN §8). Trilho de tolerância horizontal, domínio
 * [0 … máx × 1.2]. Zonas success/warning/destructive, ticks rotulados, agulha
 * do CAC atual e disclosure "Ver cálculo" com a fórmula auditável substituída.
 */
export function CacBandGauge({
  cacAtual,
  cacMinimo,
  cacIdeal,
  cacMaximo,
  despesasTotais,
  numVendas,
}: CacBandGaugeProps) {
  const [showCalc, setShowCalc] = useState(false);
  const reduce = useReducedMotion();

  const indefinido =
    cacAtual === null || cacIdeal === null || cacMaximo === null || cacMaximo <= 0;

  const domainMax = Math.max((cacMaximo ?? 0) * 1.2, 1);
  const toPct = (v: number) => Math.min(Math.max((v / domainMax) * 100, 0), 100);

  const idealPct = cacIdeal ? toPct(cacIdeal) : 0;
  const maxPct = cacMaximo ? toPct(cacMaximo) : 0;
  const atualPct = cacAtual ? toPct(cacAtual) : 0;
  const zone = indefinido ? "warning" : zoneOf(cacAtual!, cacIdeal!, cacMaximo!);

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          CAC atual
        </p>
        <p className="font-display text-[28px] tabular-nums tracking-[-0.02em] text-foreground">
          {indefinido ? "—" : formatBRL(cacAtual!)}
        </p>
      </div>

      {indefinido ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Sem vendas no período — o CAC não pode ser calculado.
        </p>
      ) : (
        <>
          {/* Trilho */}
          <div className="relative mt-6 h-3 w-full overflow-hidden rounded-full bg-muted/50">
            <motion.div
              className="absolute inset-y-0 left-0 bg-success/25"
              style={{ width: `${idealPct}%`, transformOrigin: "left" }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: reduce ? 0 : 0 }}
            />
            <motion.div
              className="absolute inset-y-0 bg-warning/25"
              style={{ left: `${idealPct}%`, width: `${maxPct - idealPct}%`, transformOrigin: "left" }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: reduce ? 0 : 0.06 }}
            />
            <motion.div
              className="absolute inset-y-0 bg-destructive/25"
              style={{ left: `${maxPct}%`, right: 0, transformOrigin: "left" }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: reduce ? 0 : 0.12 }}
            />
          </div>

          {/* Agulha do CAC atual */}
          <div className="relative h-0">
            <motion.div
              className="absolute -top-[18px]"
              initial={reduce ? false : { left: 0, opacity: 0 }}
              animate={{ left: `${atualPct}%`, opacity: 1 }}
              transition={
                reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 18 }
              }
              style={{ transform: "translateX(-50%)" }}
            >
              <span className={cn("mx-auto block h-2.5 w-2.5 rounded-full", CAP_BG[zone])} />
              <span className="mx-auto block h-[18px] w-[3px] bg-foreground" />
            </motion.div>
          </div>

          {/* Ticks */}
          <div className="relative mt-2 h-9">
            {([
              { label: "Mínimo", v: cacMinimo ?? 0, accent: false },
              { label: "Ideal", v: cacIdeal!, accent: true },
              { label: "Máximo", v: cacMaximo!, accent: false },
            ] as const).map((tick) => (
              <div
                key={tick.label}
                className="absolute top-0 -translate-x-1/2 text-center"
                style={{ left: `${toPct(tick.v)}%` }}
              >
                <span
                  className={cn(
                    "mx-auto mb-1 block h-2 w-px",
                    tick.accent ? "bg-insights" : "bg-border",
                  )}
                />
                <span
                  className={cn(
                    "block text-[10px] font-medium uppercase tracking-[0.06em]",
                    tick.accent ? "text-insights" : "text-muted-foreground",
                  )}
                >
                  {tick.label}
                </span>
                <span className="block text-[11px] tabular-nums text-foreground/70">
                  {formatBRL(tick.v)}
                </span>
              </div>
            ))}
          </div>

          {/* Ver cálculo */}
          <button
            type="button"
            onClick={() => setShowCalc((s) => !s)}
            aria-expanded={showCalc}
            className="mt-5 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-insights focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", showCalc && "rotate-90")}
            />
            Ver cálculo
          </button>
          {showCalc && (
            <p className="mt-2 font-mono text-[12px] leading-relaxed text-muted-foreground">
              CAC = Despesas totais ÷ Nº de vendas = {formatBRL(despesasTotais)} ÷{" "}
              {formatInt(numVendas)} = {formatBRL(cacAtual!)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
