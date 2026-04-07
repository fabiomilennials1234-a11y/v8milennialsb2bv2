import { memo } from "react";
import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type InsightVariant = "success" | "warning" | "info" | "danger";

interface InsightCardProps {
  icon: LucideIcon;
  title: string;
  value: string;
  subtitle: string;
  variant: InsightVariant;
  delay?: number;
}

const VARIANT_STYLES: Record<InsightVariant, { bg: string; border: string; iconBg: string; iconColor: string }> = {
  success: {
    bg: "bg-success/[0.04]",
    border: "border-success/10",
    iconBg: "bg-success/10",
    iconColor: "text-success",
  },
  warning: {
    bg: "bg-amber-500/[0.04]",
    border: "border-amber-500/10",
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-500",
  },
  danger: {
    bg: "bg-destructive/[0.04]",
    border: "border-destructive/10",
    iconBg: "bg-destructive/10",
    iconColor: "text-destructive",
  },
  info: {
    bg: "bg-blue-500/[0.04]",
    border: "border-blue-500/10",
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-500",
  },
};

function InsightCardBase({ icon: Icon, title, value, subtitle, variant, delay = 0 }: InsightCardProps) {
  const s = VARIANT_STYLES[variant];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      whileHover={{ scale: 1.02, y: -2 }}
      className={cn(
        "rounded-lg border p-4 transition-colors cursor-default",
        s.bg,
        s.border
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", s.iconBg)}>
          <Icon className={cn("w-4 h-4", s.iconColor)} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {title}
          </p>
          <p className="text-lg font-extrabold tracking-[-0.02em] tabular-nums mt-0.5 leading-tight">
            {value}
          </p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">{subtitle}</p>
        </div>
      </div>
    </motion.div>
  );
}

export const InsightCard = memo(InsightCardBase);
