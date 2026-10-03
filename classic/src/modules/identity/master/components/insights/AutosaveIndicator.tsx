import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

interface AutosaveIndicatorProps {
  status: AutosaveStatus;
  onRetry?: () => void;
}

/**
 * Estado de autosave inline (DESIGN §6): ● Salvo / ◐ Salvando… / ⚠ Erro.
 * Cor nunca sozinha — sempre acompanha ícone + rótulo textual (a11y §17).
 */
export function AutosaveIndicator({ status, onRetry }: AutosaveIndicatorProps) {
  if (status === "idle") {
    return <span className="text-[11px] text-muted-foreground/0" aria-hidden="true" />;
  }

  if (status === "saving") {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Salvando…
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success"
        role="status"
        aria-live="polite"
      >
        <Check className="h-3 w-3" />
        Salvo
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onRetry}
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive",
        "rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-insights focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        onRetry && "hover:underline",
      )}
      aria-live="assertive"
    >
      <AlertTriangle className="h-3 w-3" />
      Não foi possível salvar — tentar de novo
    </button>
  );
}
