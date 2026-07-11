import { useState } from "react";
import { ThumbsUp, ThumbsDown, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeedbackSummary as Summary } from "@/modules/platform/hooks/useHelpFeedbackSummaries";

/**
 * O agregado de "Foi útil?" de um artigo, na lista do admin: 👍N · 👎M e, se
 * houver, um toggle "motivos" que lista os textos dos 👎 — anônimos, sem nome.
 * Não renderiza nada quando o artigo ainda não tem feedback.
 */
export function FeedbackSummary({ summary }: { summary: Summary | undefined }) {
  const [open, setOpen] = useState(false);
  if (!summary || (summary.up === 0 && summary.down === 0)) return null;

  return (
    <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <ThumbsUp className="h-3 w-3" aria-hidden /> {summary.up}
      </span>
      <span className="inline-flex items-center gap-1">
        <ThumbsDown className="h-3 w-3" aria-hidden /> {summary.down}
      </span>
      {summary.reasons.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
            "hover:bg-muted/60 hover:text-foreground",
            open && "bg-muted/60 text-foreground",
          )}
          aria-expanded={open}
        >
          <MessageSquareText className="h-3 w-3" aria-hidden />
          {summary.reasons.length} {summary.reasons.length === 1 ? "motivo" : "motivos"}
        </button>
      )}
      {open && summary.reasons.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-2 text-xs shadow-lg">
          {summary.reasons.map((reason, i) => (
            <li key={i} className="border-b border-border/40 py-1.5 last:border-0 text-foreground">
              {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
