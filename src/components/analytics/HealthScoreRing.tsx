import { memo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Info } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HealthScoreRingProps {
  score: number; // 0-100
}

const SIZE = 120;
const STROKE = 8;
const R = (SIZE - STROKE) / 2;
const C = Math.PI * 2 * R; // circumference

const ZONES = [
  { end: 30, color: "hsl(0, 72%, 51%)", label: "Crítico" },
  { end: 50, color: "hsl(38, 92%, 50%)", label: "Atenção" },
  { end: 70, color: "hsl(47, 96%, 53%)", label: "Regular" },
  { end: 85, color: "hsl(142, 60%, 50%)", label: "Saudável" },
  { end: 100, color: "hsl(142, 76%, 36%)", label: "Excelente" },
] as const;

function getScoreZone(score: number) {
  return ZONES.find((z) => score <= z.end) ?? ZONES[ZONES.length - 1];
}

const EXPLANATION = `Como calculamos:

• Conversão (30%) — Taxa de leads que viram vendas. Acima de 10% = nota máxima.

• Velocidade (25%) — Tempo médio do ciclo de venda. Abaixo de 15 dias = nota máxima.

• Engajamento (20%) — Taxa de resposta da equipe. Acima de 80% = nota máxima.

• Volume (15%) — Quantidade de leads no período vs tendência.

• Eficiência (10%) — Relação LTV/CAC. Acima de 3x = nota máxima.`;

function HealthScoreRingBase({ score }: HealthScoreRingProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const clamped = Math.min(Math.max(score, 0), 100);
  const zone = getScoreZone(clamped);

  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const timeout = setTimeout(() => setAnimated(clamped), 50);
    return () => clearTimeout(timeout);
  }, [clamped]);

  const offset = C - (animated / 100) * C;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="bg-card rounded-lg border border-border p-5 flex flex-col items-center"
    >
      <div className="flex items-center justify-between w-full mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Saúde Comercial
        </p>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="p-1 rounded-md hover:bg-muted transition-colors">
                <Info className="w-3.5 h-3.5 text-muted-foreground/50" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[280px] whitespace-pre-line text-xs">
              {EXPLANATION}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"}
          strokeWidth={STROKE}
        />
        {/* Progress */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={zone.color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{
            transition: "stroke-dashoffset 1200ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
        {/* Score text */}
        <text
          x={SIZE / 2}
          y={SIZE / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={isDark ? "#fafafa" : "#1a1a1a"}
          fontSize="28"
          fontWeight="900"
          fontFamily="-apple-system, system-ui, sans-serif"
        >
          {Math.round(clamped)}
        </text>
      </svg>

      <div className="flex items-center gap-1.5 mt-2">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: zone.color }}
        />
        <span
          className="text-xs font-semibold"
          style={{ color: zone.color }}
        >
          {zone.label}
        </span>
      </div>
    </motion.div>
  );
}

export const HealthScoreRing = memo(HealthScoreRingBase);

/** Calculate composite health score from analytics data */
export function calculateHealthScore(params: {
  conversionRate: number;
  avgCycleDays: number;
  responseRatePct: number;
  leadsCount: number;
  prevLeadsCount: number;
  ltvCacRatio: number;
}): number {
  const normalize = (val: number, target: number) =>
    Math.min(val / target, 1);

  const conversion = normalize(params.conversionRate, 10) * 30;
  const velocity =
    params.avgCycleDays > 0
      ? normalize(15 / params.avgCycleDays, 1) * 25
      : 12.5;
  const engagement = normalize(params.responseRatePct, 80) * 20;
  const volume =
    params.prevLeadsCount > 0
      ? normalize(params.leadsCount / params.prevLeadsCount, 1) * 15
      : params.leadsCount > 0
        ? 10
        : 0;
  const efficiency = normalize(params.ltvCacRatio, 3) * 10;

  return Math.round(Math.min(conversion + velocity + engagement + volume + efficiency, 100));
}
