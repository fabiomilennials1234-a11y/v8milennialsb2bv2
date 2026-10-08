import { Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { DISCONTINUED_STEP_HINT } from "@/types/workflow";

/**
 * Selo de passo descontinuado (score/rating do lead — CTO, 02/10).
 *
 * O passo não é mais oferecido para criação, mas workflows já salvos podem
 * contê-lo: o canvas, a lista e o painel continuam mostrando o nó, com este
 * selo, para que ele seja achado e apagado — nunca uma tela em branco.
 */
export function DiscontinuedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.06em] text-warning-strong",
        className,
      )}
    >
      <Ban className="h-3 w-3" aria-hidden />
      Descontinuado
    </span>
  );
}

/** Selo + a frase de uma linha que diz o que fazer. */
export function DiscontinuedNotice({ className, hint = DISCONTINUED_STEP_HINT }: { className?: string; hint?: string }) {
  return (
    <div
      data-discontinued
      className={cn("flex flex-col items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/[.08] px-3 py-2.5", className)}
    >
      <DiscontinuedBadge />
      <p className="text-xs leading-relaxed text-foreground/80">{hint}</p>
    </div>
  );
}
