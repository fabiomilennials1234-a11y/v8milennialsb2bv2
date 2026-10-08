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
import { selectedDailyCapacity, type DisparoDraft, eyebrowDoPasso } from "./wizard-machine";
import {
  effectiveCap,
  capRisk,
  clampCap,
  CAP_MIN,
  CAP_MAX,
  CAP_RECOMMENDED,
} from "@/shared/disparo/speed-safety";

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

  const presets = [
    { label: "Conservador", value: CAP_MIN },
    { label: "Recomendado", value: CAP_RECOMMENDED },
    { label: "Máximo", value: CAP_MAX },
  ];
  const peak = Math.max(1, ...plan.lots.map((l) => l.dayTotal));

  return (
    <div className="space-y-7">
      <StepHeader
        kicker={eyebrowDoPasso("speed")}
        title="Em que ritmo?"
        subtitle="Quanto mais números, mais rápido — sem queimar nenhuma linha. O envio se espalha pelos dias automaticamente."
      />

      {/* Limite por número, por dia — o controle de segurança */}
      <div className="rounded-[18px] bg-muted/50 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">
              Limite por número, por dia
            </p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="text-[2.6rem] font-extrabold leading-none tracking-[-0.05em] tabular-nums text-foreground">
                {draft.capPerNumber}
              </span>
              <span className="text-sm font-semibold text-muted-foreground">por dia</span>
            </p>
          </div>
          <div role="radiogroup" aria-label="Ritmo sugerido" className="inline-flex rounded-full bg-muted p-[3px]">
            {presets.map((p) => {
              const on = draft.capPerNumber === p.value;
              return (
                <button
                  key={p.label}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setCap(p.value)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                  <span className="ml-1 tabular-nums opacity-60">{p.value}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative mt-5">
          {/* zone track behind the slider: green up to recommended, red after */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full">
            <div className="absolute inset-y-0 left-0 bg-success/30" style={{ width: `${safeZonePct}%` }} />
            <div className="absolute inset-y-0 right-0 bg-destructive/30" style={{ width: `${100 - safeZonePct}%` }} />
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
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-success/30 bg-success/[0.06] px-3 py-2 text-xs text-success-strong">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium tabular-nums">{draft.capPerNumber}/dia</span> por número —
              recomendado por nós. Número saudável.
            </span>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/[0.08] px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium tabular-nums">{draft.capPerNumber}/dia</span> por número —
              RISCO de banimento. Recomendamos {CAP_RECOMMENDED}. Você assume o risco.
            </span>
          </div>
        )}
      </div>

      {/* Estimativa do plano — capacidade somada e os dias que ela dá */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5" />
            <span className="font-bold tabular-nums text-foreground">{capacity.toLocaleString("pt-BR")}</span>/dia
            somando {draft.numbers.filter((n) => n.selected).length}{" "}
            {draft.numbers.filter((n) => n.selected).length === 1 ? "número" : "números"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarRange className="h-3.5 w-3.5" />
            {plan.dayCount > 0 ? (
              <>
                <span className="font-bold tabular-nums text-foreground">{plan.dayCount}</span>
                {plan.dayCount === 1 ? "dia" : "dias"} para {draft.audienceCount.toLocaleString("pt-BR")} contatos
              </>
            ) : (
              "—"
            )}
          </span>
        </div>
        {plan.lots.length > 1 && (
          <div className="flex h-[70px] items-end gap-1" aria-hidden>
            {plan.lots.slice(0, 31).map((lot, i) => (
              <div key={lot.dateIso} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div className="flex h-[52px] w-full max-w-[30px] items-end overflow-hidden rounded-[7px] bg-muted">
                  <div
                    className={cn("w-full rounded-[7px]", i === 0 ? "bg-primary" : "bg-foreground dark:bg-foreground/85")}
                    style={{ height: `${(lot.dayTotal / peak) * 100}%` }}
                  />
                </div>
                {plan.lots.length <= 14 && (
                  <span className="text-[9.5px] font-bold tabular-nums text-muted-foreground">{lot.dateIso.slice(8, 10)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {draft.numbers.length === 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-sunken p-4 text-sm text-muted-foreground">
          <Smartphone className="h-4 w-4 shrink-0" />
          Nenhum número de WhatsApp conectado. Conecte um número em Configurações para disparar.
        </div>
      )}

      {draft.numbers.length > 0 && (
        <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">Números que disparam</p>
      )}
      <div className="space-y-2.5">
        {draft.numbers.map((n) => (
          <button
            key={n.id}
            type="button"
            aria-pressed={n.selected}
            onClick={() => toggle(n.id)}
            className={cn(
              "flex w-full items-center gap-4 rounded-[18px] border p-4 text-left transition-[background-color,border-color,box-shadow] duration-150",
              n.selected
                ? "border-primary bg-primary-soft/60 shadow-[0_0_0_1px_hsl(var(--primary))]"
                : "border-card-border bg-card hover:border-foreground/20",
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                n.selected ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              <Smartphone className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">
                  {n.label}
                  {/* O regime fica VISÍVEL no número, não escondido no que ele
                      permite (#1722, critério 1). É ele que decide o passo
                      seguinte: texto livre no Chip, Template aprovado aqui. */}
                  {n.regime === "oficial" && (
                    <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 align-middle text-[10px] font-semibold text-primary-soft-foreground">
                      Canal Oficial · Template
                    </span>
                  )}
                </p>
                {n.isNew && (
                  <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning-strong">
                    número novo · cuidado
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                até <span className="tabular-nums">{n.cap}</span> envios/dia
                {n.isNew && draft.capPerNumber > n.cap && (
                  <span className="text-warning-strong"> (protegido)</span>
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
    </div>
  );
}
