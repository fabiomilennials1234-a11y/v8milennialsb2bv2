import { memo, useState } from "react";
import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AT } from "./analytics-tokens";

type InsightVariant = "success" | "warning" | "info" | "danger";

interface InsightCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
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
    bg: "bg-warning/[0.04]",
    border: "border-warning/10",
    iconBg: "bg-warning/10",
    iconColor: "text-warning-strong",
  },
  danger: {
    bg: "bg-destructive/[0.04]",
    border: "border-destructive/10",
    iconBg: "bg-destructive/10",
    iconColor: "text-destructive",
  },
  info: {
    bg: "bg-insights/5",
    border: "border-insights/10",
    iconBg: "bg-insights/10",
    iconColor: "text-insights",
  },
};

function InsightCardBase({ icon: Icon, title, description, variant, delay = 0 }: InsightCardProps) {
  const s = VARIANT_STYLES[variant];
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      onHoverStart={() => setExpanded(true)}
      onHoverEnd={() => setExpanded(false)}
      className={cn(
        "rounded-2xl border p-4 transition-colors cursor-default",
        s.bg,
        s.border
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[10px]", s.iconBg)}>
          <Icon className={cn("w-4 h-4", s.iconColor)} />
        </div>
        <div className="min-w-0">
          <p className={cn(AT.chartTitle, expanded ? "" : "line-clamp-2")}>
            {title}
          </p>
          <p className={cn(AT.metricSublabel, "mt-1 leading-relaxed", expanded ? "" : "line-clamp-3")}>
            {description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export const InsightCard = memo(InsightCardBase);
