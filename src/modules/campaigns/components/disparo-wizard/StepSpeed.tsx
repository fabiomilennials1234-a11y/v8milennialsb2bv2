/**
 * StepSpeed — "Velocidade & segurança" (#908).
 *
 * Two decisions: which WhatsApp numbers carry the blast, and the per-number
 * daily cap. The cap is one slider applied to every selected number, with a
 * green safe zone (≤ recommended) and a red risk zone above it (the user
 * explicitly assumes ban risk). A number flagged "new" is auto-clamped below
 * the slider. The live `planBlast` readout turns the combined capacity into
 * "→ N dias" so the operator sees the pace — and the protection — before
 * committing. Numbers are mock until real instances land — TODO(#910 dispatch).
 */
import { useMemo } from "react";
import {
  Check,
  Smartphone,
  CalendarRange,
  Gauge,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { planBlast } from "@/modules/campaigns/lib/blast-planning";
import { StepHeader } from "./StepHeader";
import { selectedDailyCapacity, type DisparoDraft } from "./wizard-machine";
import {
  effectiveCap,
  capRisk,
  clampCap,
  CAP_MIN,
  CAP_MAX,
  CAP_RECOMMENDED,
} from "./speed-safety";

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

  /**
   * The slider sets one cap for every number; each number's effective cap is
   * re-derived through the new-number clamp so a fresh line never inherits a
   * risky value. Writing it back onto `n.cap` keeps capacity/planBlast pure.
   */
  const setCap = (raw: number) => {
    const capPerNumber = clampCap(raw);
    patch({
      capPerNumber,
      numbers: draft.numbers.map((n) => ({
        ...n,
        cap: effectiveCap(capPerNumber, Boolean(n.isNew)),
      })),
    });
  };

  const risk = capRisk(draft.capPerNumber);
  const safeZonePct =
    ((CAP_RECOMMENDED - CAP_MIN) / (CAP_MAX - CAP_MIN)) * 100;

  const capacity = selectedDailyCapacity(draft);
  const plan = useMemo(
    () =>
      planBlast({
        totalRecipients: draft.audienceCount,
        numbers: draft.numbers
          .filter((n) => n.selected)
          .map((n) => ({ id: n.id, cap: n.cap })),
        startDateIso: draft.startDateIso,
      }),
    [draft.audienceCount, draft.numbers, draft.startDateIso],
  );

  return (
    <div className="space-y-7">
      <StepHeader
        kicker="Passo 4 de 6"
        title="Em que ritmo?"
        subtitle="Quanto mais números, mais rápido — sem queimar nenhuma linha. O envio se espalha pelos dias automaticamente."
      />

      {draft.numbers.length === 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/70 bg-card p-4 text-sm text-muted-foreground">
          <Smartphone className="h-4 w-4 shrink-0" />
          Nenhum número de WhatsApp conectado. Conecte um número em Configurações para disparar.
        </div>
      )}

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
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">{n.label}</p>
                {n.isNew && (
                  <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-500">
                    número novo · cuidado
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                até <span className="tabular-nums">{n.cap}</span> envios/dia
                {n.isNew && draft.capPerNumber > n.cap && (
                  <span className="text-amber-500"> (protegido)</span>
                )}
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

      {/* Per-number daily cap — the safety control */}
      <div className="rounded-xl border border-border/70 bg-card p-5">
        <div className="flex items-baseline justify-between">
          <label className="text-sm font-medium text-foreground">
            Limite por número, por dia
          </label>
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {draft.capPerNumber}
          </span>
        </div>

        <div className="relative mt-4">
          {/* zone track behind the slider: green up to recommended, red after */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full">
            <div
              className="absolute inset-y-0 left-0 bg-emerald-500/30"
              style={{ width: `${safeZonePct}%` }}
            />
            <div
              className="absolute inset-y-0 right-0 bg-destructive/30"
              style={{ width: `${100 - safeZonePct}%` }}
            />
          </div>
          <Slider
            value={[draft.capPerNumber]}
            min={CAP_MIN}
            max={CAP_MAX}
            step={5}
            onValueChange={(v) => setCap(v[0])}
            className="relative"
          />
        </div>

        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>{CAP_MIN}</span>
          <span>seguro até {CAP_RECOMMENDED}</span>
          <span>{CAP_MAX}</span>
        </div>

        {risk === "safe" ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-500">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium tabular-nums">{draft.capPerNumber}/dia</span> por número —
              recomendado por nós. Número saudável.
            </span>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/[0.08] px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium tabular-nums">{draft.capPerNumber}/dia</span> por número —
              RISCO de banimento. Recomendamos {CAP_RECOMMENDED}. Você assume o risco.
            </span>
          </div>
        )}
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
