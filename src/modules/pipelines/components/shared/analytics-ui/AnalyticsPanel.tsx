import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const DOT_CLASS: Record<string, string> = {
  gold: "bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.6)]",
  success: "bg-success shadow-[0_0_10px_hsl(var(--success)/0.6)]",
  blue: "bg-insights shadow-[0_0_10px_hsl(var(--insights)/0.6)]",
  destructive: "bg-destructive shadow-[0_0_10px_hsl(var(--destructive)/0.6)]",
};

interface AnalyticsPanelProps {
  title: string;
  subtitle?: string;
  dot?: keyof typeof DOT_CLASS;
  className?: string;
  children: ReactNode;
}

/**
 * Painel padrão dos analytics de funil — cartão de bento do V5 (era
 * `.glass-card`): título 16 px bold com o dot de tom, subtítulo, conteúdo.
 */
export function AnalyticsPanel({ title, subtitle, dot = "gold", className, children }: AnalyticsPanelProps) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-card border border-card-border bg-card p-5 text-card-foreground shadow-relevo sm:p-6",
        className,
      )}
    >
      <h3 className="flex items-center gap-2 text-base font-bold leading-tight tracking-tight">
        <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", DOT_CLASS[dot])} aria-hidden />
        {title}
      </h3>
      {subtitle && <p className="ml-[15px] mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
