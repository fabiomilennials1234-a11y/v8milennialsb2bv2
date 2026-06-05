import { AlertTriangle, Loader2, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import type { QuickBlastPreview } from "@/modules/leads";

interface BlastBreakdownProps {
  /** Total candidates resolved from the stage, before refinement narrowing. */
  candidates: number;
  preview: QuickBlastPreview | null;
  isLoading: boolean;
  error: string | null;
  /** Recency window in days, when the recency refinement is engaged. */
  recentDays: number | null;
  /**
   * "card" — the live panel in the Público step (boxed, with the hero count).
   * "inline" — the denser recap shown inside the Revisão summary.
   */
  variant?: "card" | "inline";
}

interface SkipRow {
  key: string;
  label: string;
  n: number;
}

function buildSkipRows(preview: QuickBlastPreview, recentDays: number | null): SkipRow[] {
  const { noPhone, alreadyContactedWithinWindow, replied, duplicates, overCap } = preview.skipped;
  return [
    {
      key: "recent",
      label: recentDays != null ? `já contatados (${recentDays}d)` : "já contatados",
      n: alreadyContactedWithinWindow,
    },
    { key: "replied", label: "já responderam", n: replied },
    { key: "noPhone", label: "sem telefone", n: noPhone },
    { key: "duplicates", label: "duplicados", n: duplicates },
    { key: "overCap", label: "acima do teto", n: overCap },
  ].filter((r) => r.n > 0);
}

/**
 * Quiet, tabular skip summary with monospace numerals — the "what the engine
 * will actually send" surface. Never loud: the count is the only emphasis, the
 * subtractions read like a receipt (Stripe's tabular clarity).
 */
export function BlastBreakdown({
  candidates,
  preview,
  isLoading,
  error,
  recentDays,
  variant = "card",
}: BlastBreakdownProps) {
  const inline = variant === "inline";

  // Would-send: trust the live preview; fall back to raw candidates while the
  // first dry-run settles so the operator never stares at a blank.
  const wouldSend = preview?.count ?? candidates;
  const skips = preview ? buildSkipRows(preview, recentDays) : [];
  const noPhoneAlways = !preview; // pré-preview: no-phone line surfaced as a heads-up

  return (
    <div
      className={cn(
        "rounded-lg border",
        inline
          ? "border-border/60 bg-muted/20 px-4 py-3.5"
          : "border-border/70 bg-muted/30 px-4 py-3.5",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex items-center justify-center rounded-md bg-primary/12 text-primary",
            inline ? "h-9 w-9" : "h-9 w-9",
          )}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Users className="h-4 w-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold leading-none tabular-nums tracking-tight">
              {wouldSend.toLocaleString("pt-BR")}
            </span>
            <span className="text-sm font-normal text-muted-foreground">
              {wouldSend === 1 ? "será disparado" : "serão disparados"}
            </span>
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            {isLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="tabular-nums">{candidates.toLocaleString("pt-BR")}</span>
                {candidates === 1 ? "candidato" : "candidatos"} — recalculando…
              </span>
            ) : (
              <>
                de <span className="tabular-nums text-foreground">{candidates.toLocaleString("pt-BR")}</span>{" "}
                {candidates === 1 ? "candidato" : "candidatos"} no estágio
              </>
            )}
          </p>

          {/* Skip breakdown — receipt-style subtractions */}
          {skips.length > 0 && (
            <dl className="mt-3 space-y-1 border-t border-border/50 pt-2.5">
              {skips.map((row) => (
                <div key={row.key} className="flex items-center justify-between text-xs">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="font-medium tabular-nums text-muted-foreground">
                    −{row.n.toLocaleString("pt-BR")}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {/* Pre-preview heads-up: no-phone is always excluded by the engine */}
          {noPhoneAlways && !isLoading && !error && (
            <p className="mt-2.5 border-t border-border/50 pt-2.5 text-[11px] text-muted-foreground">
              Leads sem telefone são sempre ignorados — não dá pra mensagear sem número.
            </p>
          )}

          {error && (
            <p className="mt-2.5 flex items-start gap-1.5 border-t border-border/50 pt-2.5 text-[11px] text-muted-foreground">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-warning" />
              Não deu pra prever o público agora. O servidor recalcula na hora do disparo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
