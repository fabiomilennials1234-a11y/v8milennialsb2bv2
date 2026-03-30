/**
 * SeatUsageBar — barra visual mostrando seats usados vs. pagos.
 */

import { Users } from "lucide-react";
import type { SeatUsage } from "@/hooks/useSeatUsage";

interface SeatUsageBarProps {
  usage: SeatUsage;
}

export function SeatUsageBar({ usage }: SeatUsageBarProps) {
  if (usage.is_unlimited) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="w-4 h-4" />
        <span>{usage.active_members} membros ativos</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
          Ilimitado
        </span>
      </div>
    );
  }

  const pct = usage.paid_seats > 0
    ? Math.min((usage.active_members / usage.paid_seats) * 100, 100)
    : (usage.active_members > 0 ? 100 : 0);
  const isAtLimit = usage.active_members >= usage.paid_seats;
  const isNearLimit = pct >= 80 && !isAtLimit;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" />
          <span className="font-medium">
            {usage.active_members} / {usage.paid_seats} seats
          </span>
        </div>
        {isAtLimit && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
            Limite atingido
          </span>
        )}
        {isNearLimit && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">
            {usage.remaining} restante{usage.remaining !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isAtLimit
              ? "bg-destructive"
              : isNearLimit
                ? "bg-amber-500"
                : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
