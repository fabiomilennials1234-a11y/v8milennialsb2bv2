/**
 * StepAudience — "Pra quem" (#904 shell).
 *
 * One decision: which frozen audience the blast drains. Selecting a segment
 * patches the draft (id/label/count). Real audience builder + saved segments
 * are TODO(#902/#906); the segment list is mock-structured for now.
 */
import { Check, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { StepHeader } from "./StepHeader";
import { MOCK_AUDIENCES } from "./mock-disparo-data";
import type { DisparoDraft } from "./wizard-machine";

interface StepAudienceProps {
  draft: DisparoDraft;
  patch: (p: Partial<DisparoDraft>) => void;
}

export function StepAudience({ draft, patch }: StepAudienceProps) {
  return (
    <div className="space-y-7">
      <StepHeader
        kicker="Passo 1 de 5"
        title="Pra quem você vai enviar?"
        subtitle="Escolha um público. O grupo é congelado agora — quem entrar depois não recebe este disparo."
      />

      <div className="space-y-2.5">
        {MOCK_AUDIENCES.map((aud) => {
          const selected = draft.audienceId === aud.id;
          return (
            <button
              key={aud.id}
              type="button"
              onClick={() =>
                patch({
                  audienceId: aud.id,
                  audienceLabel: aud.label,
                  audienceCount: aud.count,
                })
              }
              className={cn(
                "group flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-all duration-200",
                selected
                  ? "border-primary/60 bg-primary/[0.06] shadow-[0_0_0_1px_hsl(var(--primary)/0.3)]"
                  : "border-border/70 bg-card hover:border-border hover:bg-muted/30",
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                  selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                <Users className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{aud.label}</p>
                <p className="truncate text-xs text-muted-foreground">{aud.detail}</p>
              </div>
              <div className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-foreground">
                  {aud.count.toLocaleString("pt-BR")}
                </span>
                <span className="text-[11px] text-muted-foreground">contatos</span>
              </div>
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                {selected && <Check className="h-3 w-3" strokeWidth={3} />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
