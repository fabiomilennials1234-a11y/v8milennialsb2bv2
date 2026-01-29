import { motion } from "framer-motion";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: "default" | "primary" | "success";
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = "default",
}: MetricCardProps) {
  const variantStyles = {
    default: "bg-card border-border",
    primary: "bg-primary/5 border-primary/20",
    success: "bg-success/5 border-success/20",
  };

  const iconStyles = {
    default: "bg-muted text-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`metric-card ${variantStyles[variant]}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {trend && (
              <span
                className={`flex items-center text-xs font-medium ${
                  trend.isPositive ? "text-success" : "text-destructive"
                }`}
              >
                {trend.isPositive ? (
                  <TrendingUp className="w-3 h-3 mr-0.5" />
                ) : (
                  <TrendingDown className="w-3 h-3 mr-0.5" />
                )}
                {trend.value}%
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-3 rounded-xl ${iconStyles[variant]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </motion.div>
  );
}
