/**
 * SeatUsageBar — barra visual mostrando seats usados vs. pagos.
 */

import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SeatUsage } from "../../hooks/useSeatUsage";
interface SeatUsageBarProps {
  usage: SeatUsage;
}

const shell = "rounded-card border border-card-border bg-card px-5 py-4 text-card-foreground shadow-relevo";
const chip = "rounded-full px-2 py-0.5 text-[11px] font-bold";

export function SeatUsageBar({ usage }: SeatUsageBarProps) {
  if (usage.is_unlimited) {
    return (
      <div className={cn(shell, "flex items-center gap-2 text-sm text-muted-foreground")}>
        <Users className="h-4 w-4" />
        <span>
          <span className="font-extrabold tabular-nums text-foreground">{usage.active_members}</span> membros ativos
        </span>
        <span className={cn(chip, "bg-primary-soft text-primary-soft-foreground")}>Ilimitado</span>
      </div>
    );
  }

  const pct = usage.paid_seats > 0
    ? Math.min((usage.active_members / usage.paid_seats) * 100, 100)
    : (usage.active_members > 0 ? 100 : 0);
  const isAtLimit = usage.active_members >= usage.paid_seats;
  const isNearLimit = pct >= 80 && !isAtLimit;

  return (
    <div className={cn(shell, "space-y-2.5")}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Users className="h-4 w-4" />
          <span>
            <span className="font-extrabold tabular-nums tracking-[-0.02em] text-foreground">
              {usage.active_members} / {usage.paid_seats}
            </span>{" "}
            seats
          </span>
        </div>
        {isAtLimit && (
          <span className={cn(chip, "bg-destructive/10 text-destructive")}>
            Limite atingido
          </span>
        )}
        {isNearLimit && (
          <span className={cn(chip, "bg-warning/15 text-warning-strong")}>
            {usage.remaining} restante{usage.remaining !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isAtLimit ? "bg-destructive" : isNearLimit ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
