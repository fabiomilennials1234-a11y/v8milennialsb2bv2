import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  icon?: LucideIcon;
  label?: string;
  value?: string;
  color?: "primary" | "success" | "warning" | "destructive";
  children?: ReactNode;
}

// V5: o traço usa o preenchimento do token; o texto usa o par legível.
// Ouro como TEXTO sobre cartão branco reprova contraste — por isso `primary`
// escreve em `primary-soft-foreground` e pinta o chip em `primary-soft`; o
// âmbar idem com `warning-strong`.
const colorMap = {
  primary: { stroke: "stroke-primary", text: "text-primary-soft-foreground", bg: "bg-primary-soft" },
  success: { stroke: "stroke-success", text: "text-success", bg: "bg-success/10" },
  warning: { stroke: "stroke-warning", text: "text-warning-strong", bg: "bg-warning/15" },
  destructive: { stroke: "stroke-destructive", text: "text-destructive", bg: "bg-destructive/10" },
};

export function ProgressRing({
  progress,
  size = 120,
  strokeWidth = 8,
  icon: Icon,
  label,
  value,
  color = "primary",
  children,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (Math.min(progress, 100) / 100) * circumference;
  const colors = colorMap[color];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          className="transform -rotate-90"
          width={size}
          height={size}
        >
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted"
          />
          {/* Progress circle */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            className={colors.stroke}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1, ease: "easeOut" }}
            style={{
              strokeDasharray: circumference,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {children ? (
            children
          ) : (
            <>
              {Icon && (
                <div className={`p-2 rounded-full ${colors.bg} mb-1`}>
                  <Icon className={`w-5 h-5 ${colors.text}`} />
                </div>
              )}
              <span className={`text-lg font-extrabold tabular-nums tracking-[-0.03em] ${colors.text}`}>
                {value || `${Math.round(progress)}%`}
              </span>
            </>
          )}
        </div>
      </div>
      {label && (
        <p className="text-center text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">{label}</p>
      )}
    </div>
  );
}

export function MiniProgressRing({
  progress,
  color = "primary",
}: {
  progress: number;
  color?: "primary" | "success" | "warning" | "destructive";
}) {
  const size = 40;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (Math.min(progress, 100) / 100) * circumference;
  const colors = colorMap[color];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={colors.stroke}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ strokeDasharray: circumference }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-[10.5px] font-bold tabular-nums ${colors.text}`}>
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
}
