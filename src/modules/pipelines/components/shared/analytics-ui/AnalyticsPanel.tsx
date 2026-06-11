import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const DOT_CLASS: Record<string, string> = {
  gold: "bg-primary shadow-[0_0_12px_hsl(var(--primary))]",
  success: "bg-success shadow-[0_0_12px_hsl(var(--success))]",
  blue: "bg-chart-5 shadow-[0_0_12px_hsl(var(--chart-5))]",
  destructive: "bg-destructive shadow-[0_0_12px_hsl(var(--destructive))]",
};

interface AnalyticsPanelProps {
  title: string;
  subtitle?: string;
  dot?: keyof typeof DOT_CLASS;
  className?: string;
  children: ReactNode;
}

/** Painel padrão dos analytics de funil — título com dot luminoso + subtítulo. */
export function AnalyticsPanel({ title, subtitle, dot = "gold", className, children }: AnalyticsPanelProps) {
  return (
    <div className={cn("glass-card rounded-xl p-6", className)}>
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <span className={cn("w-[7px] h-[7px] rounded-full shrink-0", DOT_CLASS[dot])} />
        {title}
      </h3>
      {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5 ml-[15px]">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}
