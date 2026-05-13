import { DollarSign, User, Clock } from "lucide-react";
import type { Deal } from "@/hooks/useDeals";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function daysInStage(deal: Deal): number {
  const changed = (deal.metadata as any)?.stage_changed_at ?? deal.created_at;
  return Math.floor((Date.now() - new Date(changed as string).getTime()) / 86400000);
}

function agingColor(days: number): string {
  if (days < 7) return "text-emerald-500";
  if (days < 14) return "text-amber-500";
  return "text-red-500";
}

interface Props {
  deal: Deal;
  isDragging?: boolean;
}

export function DealKanbanCard({ deal, isDragging }: Props) {
  const days = daysInStage(deal);
  const productCount = deal.deal_items?.length ?? 0;

  return (
    <div
      className={`rounded-lg border bg-card p-3 space-y-2 cursor-pointer transition-shadow ${
        isDragging ? "shadow-lg ring-2 ring-primary/20" : "hover:shadow-md"
      }`}
    >
      <p className="font-medium text-sm leading-tight truncate">{deal.title}</p>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          {fmt(deal.value ?? 0)}
        </span>
        <span className="flex items-center gap-1">
          <Clock className={`h-3 w-3 ${agingColor(days)}`} />
          {days}d
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {deal.lead?.name && (
          <span className="flex items-center gap-1 truncate">
            <User className="h-3 w-3 shrink-0" />
            {deal.lead.name}
          </span>
        )}
        {productCount > 0 && (
          <span className="bg-muted rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0">
            {productCount} prod.
          </span>
        )}
      </div>
    </div>
  );
}
