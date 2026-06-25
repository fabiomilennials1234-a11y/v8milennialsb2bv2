/**
 * StepSpeed — "Velocidade" (#904 shell).
 *
 * One decision: which WhatsApp numbers carry the blast. Each number adds its
 * Number Daily Cap to the combined daily capacity; the live `planBlast` readout
 * turns that into "→ N dias" so the operator sees the pace before committing.
 * Numbers are mock for now — TODO(#908) wires real instances + caps.
 */
import { useMemo } from "react";
import { Check, Smartphone, CalendarRange, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { planBlast } from "@/modules/campaigns/lib/blast-planning";
import { StepHeader } from "./StepHeader";
import { selectedDailyCapacity, type DisparoDraft } from "./wizard-machine";

interface StepSpeedProps {
  draft: DisparoDraft;
  patch: (p: Partial<DisparoDraft>) => void;
}

export function StepSpeed({ draft, patch }: StepSpeedProps) {
  const toggle = (id: string) =>
    patch({
      numbers: draft.numbers.map((n) =>
        n.id === id ? { ...n, selected: !n.selected } : n,
      ),
    });

  const capacity = selectedDailyCapacity(draft);
  const plan = useMemo(
    () =>
      planBlast({
        totalRecipients: draft.audienceCount,
        numbers: draft.numbers.filter((n) => n.selected).map((n) => ({ id: n.id, cap: n.cap })),
        startDateIso: draft.startDateIso,
      }),
    [draft.audienceCount, draft.numbers, draft.startDateIso],
  );

  return (
    <div className="space-y-7">
      <StepHeader
        kicker="Passo 3 de 5"
        title="Em que ritmo?"
        subtitle="Quanto mais números, mais rápido — sem queimar nenhuma linha. O envio se espalha pelos dias automaticamente."
      />

      <div className="space-y-2.5">
        {draft.numbers.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => toggle(n.id)}
            className={cn(
              "flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-all duration-200",
              n.selected
                ? "border-primary/60 bg-primary/[0.06] shadow-[0_0_0_1px_hsl(var(--primary)/0.3)]"
                : "border-border/70 bg-card hover:border-border hover:bg-muted/30",
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                n.selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              <Smartphone className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{n.label}</p>
              <p className="text-xs text-muted-foreground">
                até <span className="tabular-nums">{n.cap}</span> envios/dia
              </p>
            </div>
            <div
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all",
                n.selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
              )}
            >
              {n.selected && <Check className="h-3 w-3" strokeWidth={3} />}
            </div>
          </button>
        ))}
      </div>

      {/* Live pace readout — the load-bearing feedback of this step */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" />
            Capacidade
          </div>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
            {capacity.toLocaleString("pt-BR")}
            <span className="ml-1 text-sm font-normal text-muted-foreground">/dia</span>
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <CalendarRange className="h-3.5 w-3.5" />
            Duração
          </div>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
            {plan.dayCount > 0 ? (
              <>
                {plan.dayCount}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  {plan.dayCount === 1 ? "dia" : "dias"}
                </span>
              </>
            ) : (
              <span className="text-sm font-normal text-muted-foreground">—</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
