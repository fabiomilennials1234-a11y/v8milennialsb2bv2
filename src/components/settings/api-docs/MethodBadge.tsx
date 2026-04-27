import { cn } from "@/lib/utils";

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  POST: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  PUT: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  PATCH: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  DELETE: "bg-red-500/15 text-red-400 border-red-500/25",
};

interface MethodBadgeProps {
  method: string;
  className?: string;
}

export function MethodBadge({ method, className }: MethodBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold font-mono uppercase border",
        METHOD_STYLES[method] || "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
        className,
      )}
    >
      {method}
    </span>
  );
}
