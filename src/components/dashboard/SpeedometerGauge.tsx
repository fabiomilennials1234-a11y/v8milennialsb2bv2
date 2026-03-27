import { memo, useRef, useEffect, useCallback } from "react";

interface SpeedometerGaugeProps {
  currentPercent: number;
  expectedPercent: number;
  goalLabel: string;
  currentLabel: string;
  subtitle?: string;
}

const W = 420;
const H = 280;
const CX = W / 2;
const CY = 210;
const R = 160;
const MAX_PCT = 130;
const START_ANGLE = Math.PI * 0.8;
const SWEEP = Math.PI * 1.5; // 270 degrees

function pctToAngle(pct: number) {
  return START_ANGLE + (pct / MAX_PCT) * SWEEP;
}

function SpeedometerGaugeBase({
  currentPercent,
  expectedPercent,
  goalLabel,
  currentLabel,
  subtitle,
}: SpeedometerGaugeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>();
  const startTimeRef = useRef<number>(0);

  const clampedCurrent = Math.min(Math.max(currentPercent, 0), MAX_PCT);
  const clampedExpected = Math.min(Math.max(expectedPercent, 0), MAX_PCT);
  const isAhead = currentPercent >= expectedPercent;

  const draw = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!startTimeRef.current) startTimeRef.current = timestamp;
    const elapsed = timestamp - startTimeRef.current;
    const rawProgress = Math.min(elapsed / 1400, 1);
    const ease = 1 - Math.pow(1 - rawProgress, 3);

    ctx.clearRect(0, 0, W, H);

    // Background arc
    ctx.beginPath();
    ctx.arc(CX, CY, R, START_ANGLE, START_ANGLE + SWEEP, false);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    ctx.stroke();

    // Color zones
    const zones = [
      { end: 80, color: "rgba(34,197,94,0.1)" },
      { end: 100, color: "rgba(245,158,11,0.12)" },
      { end: 130, color: "rgba(239,68,68,0.08)" },
    ];
    let zoneStart = 0;
    for (const zone of zones) {
      ctx.beginPath();
      ctx.arc(CX, CY, R, pctToAngle(zoneStart), pctToAngle(zone.end), false);
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 14;
      ctx.lineCap = "butt";
      ctx.setLineDash([]);
      ctx.stroke();
      zoneStart = zone.end;
    }

    // Animated progress arc
    const progressAngle = pctToAngle(clampedCurrent * ease);
    ctx.beginPath();
    ctx.arc(CX, CY, R, START_ANGLE, progressAngle, false);
    ctx.strokeStyle = isAhead ? "#22c55e" : "hsl(221.2, 83.2%, 53.3%)";
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    ctx.stroke();

    // Tick marks
    for (let pct = 0; pct <= 130; pct += 10) {
      const angle = pctToAngle(pct);
      const isMajor = pct % 20 === 0;
      const innerR = isMajor ? R - 20 : R - 14;
      const outerR = R - 6;

      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(angle) * innerR, CY + Math.sin(angle) * innerR);
      ctx.lineTo(CX + Math.cos(angle) * outerR, CY + Math.sin(angle) * outerR);
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)";
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.setLineDash([]);
      ctx.stroke();

      if (isMajor) {
        const lx = CX + Math.cos(angle) * (R - 30);
        const ly = CY + Math.sin(angle) * (R - 30);
        ctx.font = "500 11px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(pct + "%", lx, ly);
      }
    }

    // Expected needle (red, thinner)
    const expAngle = pctToAngle(clampedExpected * ease);
    const expTipX = CX + Math.cos(expAngle) * (R - 24);
    const expTipY = CY + Math.sin(expAngle) * (R - 24);
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.lineTo(expTipX, expTipY);
    ctx.strokeStyle = "rgba(239,68,68,0.5)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(expTipX, expTipY, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(239,68,68,0.5)";
    ctx.fill();

    // Current needle (green/blue, thicker)
    const curAngle = pctToAngle(clampedCurrent * ease);
    const curTipX = CX + Math.cos(curAngle) * (R - 16);
    const curTipY = CY + Math.sin(curAngle) * (R - 16);
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.lineTo(curTipX, curTipY);
    ctx.strokeStyle = isAhead ? "#22c55e" : "hsl(221.2, 83.2%, 53.3%)";
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(curTipX, curTipY, 5, 0, Math.PI * 2);
    ctx.fillStyle = isAhead ? "#22c55e" : "hsl(221.2, 83.2%, 53.3%)";
    ctx.fill();

    // Glow on tip
    if (ease > 0.5) {
      const glowOpacity = 0.3 + 0.3 * Math.sin(timestamp / 500);
      ctx.beginPath();
      ctx.arc(curTipX, curTipY, 10, 0, Math.PI * 2);
      ctx.fillStyle = isAhead
        ? `rgba(34,197,94,${glowOpacity})`
        : `rgba(99,102,241,${glowOpacity})`;
      ctx.fill();
    }

    // Center hub
    ctx.beginPath();
    ctx.arc(CX, CY, 16, 0, Math.PI * 2);
    ctx.fillStyle = "hsl(240, 10%, 3.9%)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(CX, CY, 7, 0, Math.PI * 2);
    ctx.fillStyle = "hsl(221.2, 83.2%, 53.3%)";
    ctx.fill();

    // Percentage text
    const displayPct = Math.round(clampedCurrent * ease);
    ctx.font = "bold 32px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#fafafa";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(displayPct + "%", CX, CY + 50);

    animRef.current = requestAnimationFrame(draw);
  }, [clampedCurrent, clampedExpected, isAhead]);

  useEffect(() => {
    startTimeRef.current = 0;
    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [draw]);

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ maxWidth: "420px", width: "100%" }}
      />

      {/* Legend */}
      <div className="flex items-center gap-6 mt-1 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-destructive/50 rounded" />
          <span className="text-muted-foreground">Meta esperada</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-4 h-0.5 rounded ${isAhead ? "bg-success" : "bg-primary"}`} />
          <span className="text-muted-foreground">Realizado</span>
        </div>
      </div>

      {/* Value labels */}
      <div className="flex items-center justify-center gap-8 mt-3">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Meta</p>
          <p className="text-sm font-bold">{goalLabel}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Realizado</p>
          <p className={`text-sm font-bold ${isAhead ? "text-success" : ""}`}>{currentLabel}</p>
        </div>
        {subtitle && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Progresso</p>
            <p className="text-sm font-medium">{subtitle}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export const SpeedometerGauge = memo(SpeedometerGaugeBase);
