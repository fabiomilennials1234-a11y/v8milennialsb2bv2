/**
 * /disparos — Disparos panel (#707/#709).
 *
 * Monitor + control the org's Blast Plans: a frozen audience drained over
 * consecutive days (ADR-0003). Operator can pause / resume / cancel each plan
 * and watch recipient-level progress.
 *
 * Plans grouped by lifecycle (Ativos / Pausados / Concluídos). Cards live in
 * `BlastPlanCard` (each owns its own progress query). Read-only-ish operational
 * surface — creation happens via the "Disparo" button in the funnel, not here.
 */
import { useEffect, useMemo } from "react";
import {
  useBlastPlans,
  type BlastPlan,
  type BlastPlanStatus,
} from "@/modules/campaigns/hooks/useBlastPlans";
import { useOrganization } from "@/modules/identity";
import { trackModuleVisit } from "@/lib/analytics";
import { BlastPlanCard } from "@/modules/campaigns/components/BlastPlanCard";
import { Send, Loader2, AlertTriangle, Inbox } from "lucide-react";

// Concluídos groups both terminal states — operator reads them the same way.
const GROUPS: { key: string; title: string; match: (s: BlastPlanStatus) => boolean }[] = [
  { key: "active", title: "Ativos", match: (s) => s === "active" },
  { key: "paused", title: "Pausados", match: (s) => s === "paused" },
  { key: "done", title: "Concluídos", match: (s) => s === "completed" || s === "cancelled" },
];

export default function DisparosPanel() {
  const { organizationId } = useOrganization();
  useEffect(() => {
    trackModuleVisit("disparos", organizationId);
  }, [organizationId]);

  const { data: plans, isLoading, isError, refetch } = useBlastPlans();

  const grouped = useMemo(() => {
    const list = plans ?? [];
    return GROUPS.map((g) => ({
      ...g,
      items: list.filter((p: BlastPlan) => g.match(p.status)),
    })).filter((g) => g.items.length > 0);
  }, [plans]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Header */}
      <header className="space-y-1">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          <Send className="h-6 w-6 text-primary" />
          Disparos
        </h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe e controle os disparos em massa agendados ao longo dos dias.
        </p>
      </header>

      {/* Loading */}
      {isLoading && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 py-12 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Não foi possível carregar os disparos
            </p>
            <p className="text-sm text-muted-foreground">
              Tente novamente em alguns instantes.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="mt-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && grouped.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="max-w-sm space-y-1.5">
            <p className="text-base font-semibold text-foreground">
              Nenhum disparo agendado
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Crie um plano pelo botão Disparo no funil quando o público passar do teto
              diário.
            </p>
          </div>
        </div>
      )}

      {/* Groups */}
      {!isLoading && !isError && grouped.length > 0 && (
        <div className="space-y-8">
          {grouped.map((group) => (
            <section key={group.key} className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {group.items.length}
                </span>
              </div>
              <div className="space-y-3">
                {group.items.map((plan) => (
                  <BlastPlanCard key={plan.id} plan={plan} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
