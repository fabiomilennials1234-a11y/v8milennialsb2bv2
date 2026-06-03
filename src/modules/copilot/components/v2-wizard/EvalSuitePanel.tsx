/**
 * EvalSuitePanel — Slice 9 "rodar eval-suite" (Copilot v2). Runs the archetype's
 * eval cases (dry-run) and shows PASS / FAIL / SKIP per case with expected-vs-actual.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRunEvalSuite } from "../../hooks/useCopilotV2Simulator";
import type { Archetype } from "../../lib/copilot-v2-config";
import type { EvalStatus } from "../../lib/copilot-v2-sim";

const STATUS_STYLE: Record<EvalStatus, string> = {
  pass: "border-emerald-500/50 text-emerald-500",
  fail: "border-destructive/60 text-destructive",
  skip: "border-border/60 text-muted-foreground",
  error: "border-amber-500/60 text-amber-500",
};

export function EvalSuitePanel({ archetype }: { archetype: Archetype }) {
  const run = useRunEvalSuite();
  const data = run.data;

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Eval-suite</span>
        <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.mutate({ archetype })}>
          {run.isPending ? "Rodando…" : "Rodar eval-suite"}
        </Button>
      </div>

      {data && (
        <>
          <div className="flex gap-2 text-xs">
            <Badge variant="outline" className="border-emerald-500/50 text-emerald-500">{data.summary.pass} pass</Badge>
            <Badge variant="outline" className="border-destructive/60 text-destructive">{data.summary.fail} fail</Badge>
            <Badge variant="outline" className="text-muted-foreground">{data.summary.skip} skip</Badge>
            {data.summary.error > 0 && (
              <Badge variant="outline" className="border-amber-500/60 text-amber-500">{data.summary.error} erro</Badge>
            )}
          </div>
          <ul className="space-y-1.5">
            {data.results.map((r) => (
              <li key={r.caseId} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex-1 truncate" title={r.reasoning}>{r.caseName}</span>
                <Badge variant="outline" className={cn("uppercase", STATUS_STYLE[r.status])}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        </>
      )}
      {run.isError && <p className="text-xs text-destructive">Falha ao rodar a eval-suite.</p>}
    </div>
  );
}
