/**
 * StepAudience — "Pra quem" (#902 + #906).
 *
 * One screen, one decision: who receives the blast. Two sources, picked by a
 * segmented control:
 *   - "Por etapa do funil" (#902) — a system pipe or custom pipeline stage,
 *     optionally narrowed by conditions; resolves LIVE to a frozen lead set.
 *   - "Subir planilha" (#906, ADR-0014) — upload a CSV; new contacts become
 *     Leads in a chosen funnel/stage, existing ones are matched as-is.
 *
 * Both sources write the same draft fields (leadIds / audienceCount /
 * audienceLabel / audienceSource) so the rest of the wizard reads one shape.
 * The audience is frozen at creation (ADR-0003): whoever matches now receives it.
 */
import { Users, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { StepHeader } from "./StepHeader";
import { AudienceByStage } from "./AudienceByStage";
import { AudienceBySpreadsheet } from "./AudienceBySpreadsheet";
import type { AudienceSourceType, DisparoDraft } from "./wizard-machine";
import { eyebrowDoPasso } from "./wizard-machine";

interface StepAudienceProps {
  draft: DisparoDraft;
  patch: (p: Partial<DisparoDraft>) => void;
}

const SOURCES: { id: AudienceSourceType; label: string; description: string; icon: React.ElementType }[] = [
  {
    id: "estagio",
    label: "Por etapa do funil",
    description: "Escolha o funil e a etapa. Quem está lá agora recebe.",
    icon: Users,
  },
  {
    id: "planilha",
    label: "Subir planilha",
    description: "Lista de feira, base antiga ou evento. Contato novo vira lead no funil que você escolher.",
    icon: FileSpreadsheet,
  },
];

export function StepAudience({ draft, patch }: StepAudienceProps) {
  const source = draft.audienceSourceType ?? "estagio";

  const selectSource = (next: AudienceSourceType) => {
    if (next === source) return;
    // Switching source clears the frozen set — each source re-resolves its own.
    patch({
      audienceSourceType: next,
      leadIds: [],
      audienceCount: 0,
      audienceLabel: "",
      audienceSource: null,
    });
  };

  return (
    <div className="space-y-7">
      <StepHeader
        kicker={eyebrowDoPasso("audience")}
        title="Pra quem vai o disparo?"
        subtitle="Escolha por etapa do funil ou suba uma planilha. O grupo é congelado agora — quem entrar depois não recebe este disparo."
      />

      {/* Origem — cartões-opção com rádio */}
      <div role="radiogroup" aria-label="Origem do público" className="grid gap-3 sm:grid-cols-2">
        {SOURCES.map(({ id, label, description, icon: Icon }) => {
          const active = source === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => selectSource(id)}
              className={cn(
                "flex items-start gap-3.5 rounded-[18px] border p-4 text-left transition-[background-color,border-color,box-shadow] duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary-soft/70 shadow-[0_0_0_1px_hsl(var(--primary))]"
                  : "border-card-border bg-card hover:border-foreground/20",
              )}
            >
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-[11px]",
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-foreground">{label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2",
                  active ? "border-primary-soft-foreground" : "border-border",
                )}
              >
                {active && <span className="h-2 w-2 rounded-full bg-primary-soft-foreground" />}
              </span>
            </button>
          );
        })}
      </div>

      {source === "estagio" ? (
        <AudienceByStage draft={draft} patch={patch} />
      ) : (
        <AudienceBySpreadsheet draft={draft} patch={patch} />
      )}
    </div>
  );
}
