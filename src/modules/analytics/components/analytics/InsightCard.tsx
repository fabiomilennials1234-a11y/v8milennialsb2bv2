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
