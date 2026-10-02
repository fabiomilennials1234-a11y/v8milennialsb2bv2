import { cn } from "@/lib/utils";

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-success/10 text-success border-success/25",
  POST: "bg-insights/10 text-insights border-insights/25",
  PUT: "bg-warning/15 text-warning-strong border-warning/30",
  PATCH: "bg-primary-soft text-primary-soft-foreground border-primary/25",
  DELETE: "bg-destructive/10 text-destructive border-destructive/25",
};

interface MethodBadgeProps {
  method: string;
  className?: string;
}

export function MethodBadge({ method, className }: MethodBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold uppercase",
        METHOD_STYLES[method] || "bg-muted text-muted-foreground border-border",
        className,
      )}
    >
      {method}
    </span>
  );
}
