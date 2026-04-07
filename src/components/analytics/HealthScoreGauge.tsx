import { memo, useRef, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HealthScoreGaugeProps {
  score: number; // 0-100
}

const W = 300;
const H = 200;
const CX = W / 2;
const CY = 170;
const R = 130;
const START_ANGLE = Math.PI * 0.85;
const SWEEP = Math.PI * 1.3;

function scoreToAngle(score: number) {
  return START_ANGLE + (Math.min(Math.max(score, 0), 100) / 100) * SWEEP;
}

const ZONES = [
  { end: 30, color: "hsl(0, 72%, 51%)", label: "Critico" },
  { end: 50, color: "hsl(38, 92%, 50%)", label: "Atenção" },
  { end: 70, color: "hsl(47, 96%, 53%)", label: "Regular" },
  { end: 85, color: "hsl(142, 60%, 50%)", label: "Saudável" },
  { end: 100, color: "hsl(142, 76%, 36%)", label: "Excelente" },
] as const;

function getScoreZone(score: number) {
  return ZONES.find((z) => score <= z.end) ?? ZONES[ZONES.length - 1];
}

function HealthScoreGaugeBase({ score }: HealthScoreGaugeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const zone = getScoreZone(score);
  const clamped = Math.min(Math.max(score, 0), 100);

  const draw = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const ease = Math.min(elapsed / 1200, 1);
      const eased = 1 - Math.pow(1 - ease, 3);

      ctx.clearRect(0, 0, W, H);

      // Background arc
      ctx.beginPath();
      ctx.arc(CX, CY, R, START_ANGLE, START_ANGLE + SWEEP, false);
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)";
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.stroke();

      // Zone colors (subtle bg)
      let zoneStart = 0;
      for (const z of ZONES) {
        ctx.beginPath();
        ctx.arc(CX, CY, R, scoreToAngle(zoneStart), scoreToAngle(z.end), false);
        ctx.strokeStyle = z.color.replace(")", ", 0.1)").replace("hsl(", "hsla(");
        ctx.lineWidth = 12;
        ctx.lineCap = "butt";
        ctx.stroke();
        zoneStart = z.end;
      }

      // Animated progress arc
      const currentScore = clamped * eased;
      const currentZone = getScoreZone(currentScore);
      ctx.beginPath();
      ctx.arc(CX, CY, R, START_ANGLE, scoreToAngle(currentScore), false);
      ctx.strokeStyle = currentZone.color;
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.stroke();

      // Tick marks (every 10)
      for (let s = 0; s <= 100; s += 10) {
        const angle = scoreToAngle(s);
        const isMajor = s % 20 === 0;
        const innerR = isMajor ? R - 18 : R - 12;
        const outerR = R - 5;

        ctx.beginPath();
        ctx.moveTo(CX + Math.cos(angle) * innerR, CY + Math.sin(angle) * innerR);
        ctx.lineTo(CX + Math.cos(angle) * outerR, CY + Math.sin(angle) * outerR);
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";
        ctx.lineWidth = isMajor ? 1.5 : 0.8;
        ctx.stroke();

        if (isMajor) {
          const lx = CX + Math.cos(angle) * (R - 26);
          const ly = CY + Math.sin(angle) * (R - 26);
          ctx.font = "500 9px -apple-system, sans-serif";
          ctx.fillStyle = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.3)";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(s), lx, ly);
        }
      }

      // Needle
      const needleAngle = scoreToAngle(currentScore);
      const tipX = CX + Math.cos(needleAngle) * (R - 18);
      const tipY = CY + Math.sin(needleAngle) * (R - 18);

      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.lineTo(tipX, tipY);
      ctx.strokeStyle = currentZone.color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.stroke();

      // Tip dot
      ctx.beginPath();
      ctx.arc(tipX, tipY, 4, 0, Math.PI * 2);
      ctx.fillStyle = currentZone.color;
      ctx.fill();

      // Glow
      if (eased > 0.5) {
        const glowOpacity = 0.15 + 0.15 * Math.sin(timestamp / 600);
        ctx.beginPath();
        ctx.arc(tipX, tipY, 8, 0, Math.PI * 2);
        ctx.fillStyle = currentZone.color
          .replace(")", `, ${glowOpacity})`)
          .replace("hsl(", "hsla(");
        ctx.fill();
      }

      // Hub
      ctx.beginPath();
      ctx.arc(CX, CY, 10, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? "hsl(36, 20%, 12%)" : "hsl(42, 25%, 96%)";
      ctx.fill();
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(CX, CY, 4, 0, Math.PI * 2);
      ctx.fillStyle = currentZone.color;
      ctx.fill();

      // Score text
      const displayScore = Math.round(currentScore);
      ctx.font = "800 28px -apple-system, sans-serif";
      ctx.fillStyle = isDark ? "#fafafa" : "#1a1a1a";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(displayScore), CX, CY + 38);

      if (ease < 1) {
        animRef.current = requestAnimationFrame(draw);
      }
    },
    [clamped, isDark]
  );

  useEffect(() => {
    startTimeRef.current = 0;
    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [draw]);

  const EXPLANATION = `Como calculamos:

• Conversão (30%) — Taxa de leads que viram vendas. Acima de 10% = nota máxima.

• Velocidade (25%) — Tempo médio do ciclo de venda. Abaixo de 15 dias = nota máxima.

• Engajamento (20%) — Taxa de resposta da equipe. Acima de 80% = nota máxima.

• Volume (15%) — Quantidade de leads no período vs tendência.

• Eficiência (10%) — Relação LTV/CAC. Acima de 3x = nota máxima.`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="bg-card rounded-lg border border-border p-5"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="stat-card-label flex items-center gap-1.5">Saúde Comercial</p>
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

      <div className="flex flex-col items-center">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ maxWidth: "300px", width: "100%" }}
        />

        <div className="flex items-center gap-1.5 -mt-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: zone.color }}
          />
          <span
            className="text-sm font-bold"
            style={{ color: zone.color }}
          >
            {zone.label}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export const HealthScoreGauge = memo(HealthScoreGaugeBase);

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
