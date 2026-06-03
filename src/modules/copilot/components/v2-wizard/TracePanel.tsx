/**
 * TracePanel — renders a Copilot v2 dry-run trace (Slice 9). Shows the cognition
 * step, each tool (allowed / blocked + reason), and the extracted tier. Dark-first.
 */

import { Badge } from "@/components/ui/badge";
import { STEP_LABEL, type DryRunTrace } from "../../lib/copilot-v2-sim";

export function TracePanel({ trace }: { trace: DryRunTrace }) {
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Trace (dry-run — nada é executado)</span>
        {trace.result.tier && (
          <Badge variant="outline" className="border-primary/50 capitalize text-primary">
            tier: {trace.result.tier}
          </Badge>
        )}
      </div>
      <ol className="space-y-1.5">
        {trace.steps.map((s, i) => {
          const name = (s.meta as { name?: string }).name;
          const allowed = (s.meta as { allowed?: boolean }).allowed;
          return (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 min-w-[68px] font-mono text-muted-foreground">{STEP_LABEL[s.step]}</span>
              <span className="flex-1">
                {s.step === "tool" ? (
                  <span className="flex items-center gap-2">
                    <code className="text-foreground">{name}</code>
                    {allowed ? (
                      <span className="text-primary">IRIA executar</span>
                    ) : (
                      <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                        bloqueado: {s.reason}
                      </Badge>
                    )}
                  </span>
                ) : s.step === "cognition" ? (
                  <span className="text-muted-foreground">
                    {(s.meta as { archetype?: string }).archetype} · {(s.meta as { model?: string }).model}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{s.reason ?? ""}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
