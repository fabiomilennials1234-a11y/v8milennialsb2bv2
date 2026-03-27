import { memo, useMemo } from "react";
import { motion } from "framer-motion";

interface SpeedometerGaugeProps {
  currentPercent: number;
  expectedPercent: number;
  goalLabel: string;
  currentLabel: string;
  subtitle?: string;
}

function SpeedometerGaugeBase({
  currentPercent,
  expectedPercent,
  goalLabel,
  currentLabel,
  subtitle,
}: SpeedometerGaugeProps) {
  const MAX_PCT = 130;
  const clampedCurrent = Math.min(Math.max(currentPercent, 0), MAX_PCT);
  const clampedExpected = Math.min(Math.max(expectedPercent, 0), MAX_PCT);

  // Arc from -135deg to +135deg = 270deg sweep
  const MIN_ANGLE = -135;
  const MAX_ANGLE = 135;
  const RANGE = MAX_ANGLE - MIN_ANGLE;

  const currentAngle = MIN_ANGLE + (clampedCurrent / MAX_PCT) * RANGE;
  const expectedAngle = MIN_ANGLE + (clampedExpected / MAX_PCT) * RANGE;

  const isAhead = currentPercent >= expectedPercent;

  const ticks = useMemo(() => {
    const result = [];
    for (let i = 0; i <= 13; i++) {
      const pct = i * 10;
      const angle = MIN_ANGLE + (pct / MAX_PCT) * RANGE;
      const rad = ((angle - 90) * Math.PI) / 180;
      const isMajor = pct % 20 === 0;
      const innerR = isMajor ? 72 : 76;
      const outerR = 82;
      result.push({
        x1: 100 + innerR * Math.cos(rad),
        y1: 100 + innerR * Math.sin(rad),
        x2: 100 + outerR * Math.cos(rad),
        y2: 100 + outerR * Math.sin(rad),
        label: isMajor ? `${pct}%` : null,
        labelX: 100 + 62 * Math.cos(rad),
        labelY: 100 + 62 * Math.sin(rad),
        isMajor,
      });
    }
    return result;
  }, []);

  // SVG arc path helper
  const describeArc = (cx: number, cy: number, r: number, startDeg: number, endDeg: number) => {
    const startRad = ((startDeg - 90) * Math.PI) / 180;
    const endRad = ((endDeg - 90) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  // Color zones on the arc: green zone (0-80), yellow (80-100), red (100-130)
  const zones = [
    { start: MIN_ANGLE, end: MIN_ANGLE + (80 / MAX_PCT) * RANGE, color: "hsl(var(--success))", opacity: 0.15 },
    { start: MIN_ANGLE + (80 / MAX_PCT) * RANGE, end: MIN_ANGLE + (100 / MAX_PCT) * RANGE, color: "hsl(var(--warning))", opacity: 0.15 },
    { start: MIN_ANGLE + (100 / MAX_PCT) * RANGE, end: MAX_ANGLE, color: "hsl(var(--destructive))", opacity: 0.1 },
  ];

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 130" className="w-full max-w-[380px]">
        {/* Outer ring / bezel */}
        <circle cx={100} cy={100} r={88} fill="none" stroke="hsl(var(--border))" strokeWidth="1" opacity={0.5} />

        {/* Background arc */}
        <path
          d={describeArc(100, 100, 82, MIN_ANGLE, MAX_ANGLE)}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="10"
          strokeLinecap="round"
        />

        {/* Color zone arcs */}
        {zones.map((zone, i) => (
          <path
            key={i}
            d={describeArc(100, 100, 82, zone.start, zone.end)}
            fill="none"
            stroke={zone.color}
            strokeWidth="10"
            strokeLinecap="butt"
            opacity={zone.opacity}
          />
        ))}

        {/* Progress arc */}
        <motion.path
          d={describeArc(100, 100, 82, MIN_ANGLE, MIN_ANGLE + 0.1)}
          fill="none"
          stroke={isAhead ? "hsl(var(--success))" : "hsl(var(--primary))"}
          strokeWidth="10"
          strokeLinecap="round"
          initial={false}
          animate={{
            d: describeArc(100, 100, 82, MIN_ANGLE, currentAngle),
          }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />

        {/* Tick marks */}
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={tick.x1} y1={tick.y1}
              x2={tick.x2} y2={tick.y2}
              stroke="hsl(var(--foreground))"
              strokeWidth={tick.isMajor ? 1.5 : 0.75}
              opacity={tick.isMajor ? 0.5 : 0.2}
            />
            {tick.label && (
              <text
                x={tick.labelX} y={tick.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize="6"
                fontWeight="500"
              >
                {tick.label}
              </text>
            )}
          </g>
        ))}

        {/* Expected needle (red, thinner) */}
        <motion.line
          x1={100} y1={100}
          x2={100} y2={28}
          stroke="hsl(var(--destructive))"
          strokeWidth="1.5"
          opacity={0.5}
          strokeLinecap="round"
          style={{ transformOrigin: "100px 100px" }}
          initial={{ rotate: MIN_ANGLE - 90 }}
          animate={{ rotate: expectedAngle - 90 }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
        />
        <motion.circle
          cx={100} cy={28} r={2.5}
          fill="hsl(var(--destructive))"
          opacity={0.5}
          style={{ transformOrigin: "100px 100px" }}
          initial={{ rotate: MIN_ANGLE - 90 }}
          animate={{ rotate: expectedAngle - 90 }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
        />

        {/* Current needle (primary, thicker) */}
        <motion.line
          x1={100} y1={100}
          x2={100} y2={22}
          stroke={isAhead ? "hsl(var(--success))" : "hsl(var(--primary))"}
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ transformOrigin: "100px 100px" }}
          initial={{ rotate: MIN_ANGLE - 90 }}
          animate={{ rotate: currentAngle - 90 }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.5 }}
        />
        <motion.circle
          cx={100} cy={22} r={3.5}
          fill={isAhead ? "hsl(var(--success))" : "hsl(var(--primary))"}
          style={{ transformOrigin: "100px 100px" }}
          initial={{ rotate: MIN_ANGLE - 90 }}
          animate={{ rotate: currentAngle - 90 }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.5 }}
        />

        {/* Glow on needle tip when ahead */}
        {isAhead && (
          <motion.circle
            cx={100} cy={22} r={6}
            fill="none"
            stroke="hsl(var(--success))"
            strokeWidth="1.5"
            style={{ transformOrigin: "100px 100px" }}
            initial={{ rotate: MIN_ANGLE - 90, opacity: 0 }}
            animate={{ rotate: currentAngle - 90, opacity: [0.7, 0.15, 0.7] }}
            transition={{
              rotate: { duration: 1.2, ease: "easeOut", delay: 0.5 },
              opacity: { repeat: Infinity, duration: 2, delay: 1.7 },
            }}
          />
        )}

        {/* Pulsing alert when behind */}
        {!isAhead && currentPercent > 0 && (
          <motion.circle
            cx={100} cy={22} r={5}
            fill="none"
            stroke="hsl(var(--warning))"
            strokeWidth="1"
            style={{ transformOrigin: "100px 100px" }}
            initial={{ rotate: MIN_ANGLE - 90, opacity: 0 }}
            animate={{ rotate: currentAngle - 90, opacity: [0.5, 0.1, 0.5] }}
            transition={{
              rotate: { duration: 1.2, ease: "easeOut", delay: 0.5 },
              opacity: { repeat: Infinity, duration: 1.5, delay: 1.7 },
            }}
          />
        )}

        {/* Center hub */}
        <circle cx={100} cy={100} r={10} fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
        <circle cx={100} cy={100} r={5} fill="hsl(var(--primary))" />

        {/* Center percentage */}
        <text
          x={100} y={118}
          textAnchor="middle"
          className="fill-foreground"
          fontSize="16"
          fontWeight="bold"
        >
          {Math.round(currentPercent)}%
        </text>
      </svg>

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
