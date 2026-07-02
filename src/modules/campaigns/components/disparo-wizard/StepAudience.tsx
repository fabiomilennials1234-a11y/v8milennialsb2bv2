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

interface StepAudienceProps {
  draft: DisparoDraft;
  patch: (p: Partial<DisparoDraft>) => void;
}

const SOURCES: { id: AudienceSourceType; label: string; icon: React.ElementType }[] = [
  { id: "estagio", label: "Por etapa do funil", icon: Users },
  { id: "planilha", label: "Subir planilha", icon: FileSpreadsheet },
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
        kicker="Passo 1 de 6"
        title="Pra quem você vai enviar?"
        subtitle="Escolha por etapa do funil ou suba uma planilha. O grupo é congelado agora — quem entrar depois não recebe este disparo."
      />

      {/* Source toggle */}
      <div className="grid grid-cols-2 gap-2">
        {SOURCES.map(({ id, label, icon: Icon }) => {
          const active = source === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => selectSource(id)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                active
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
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
