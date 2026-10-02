import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { PendingOrder } from "@/modules/carteira/hooks/useOrderApproval";

// V5: hex de tema escuro fixo → tons de token (funcionam nos dois temas).
export const SOURCE_STYLES: Record<string, { className: string; label: string }> = {
  copilot: { className: "bg-insights/10 text-insights", label: "Copilot" },
  manual: { className: "bg-primary-soft text-primary-soft-foreground", label: "Manual" },
  pipe: { className: "bg-success/10 text-success", label: "Funil" },
  erp: { className: "bg-foreground/[.07] text-foreground/80", label: "ERP" },
  csv_import: { className: "bg-muted text-muted-foreground", label: "CSV" },
};

interface OrderApprovalCardProps {
  order: PendingOrder;
  onApprove: (orderId: string) => void;
  onReject: (orderId: string, comment?: string) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
}

export function OrderApprovalCard({
  order,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: OrderApprovalCardProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");

  const source = SOURCE_STYLES[order.source ?? ""] ?? SOURCE_STYLES.csv_import;
  const dateStr = new Date(order.created_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
  const valueStr = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(order.sale_value);

  return (
    <div className="space-y-3 rounded-card border border-card-border bg-card p-5 shadow-relevo">
      {/* Header: client + value */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">
            {order.client_name}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">{dateStr}</span>
            <span aria-hidden>·</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", source.className)}>
              {source.label}
            </span>
          </p>
        </div>
        <span className="shrink-0 text-lg font-extrabold tabular-nums tracking-[-0.03em] text-foreground">{valueStr}</span>
      </div>

      {/* Items chips */}
      {order.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {order.items.map((item) => (
            <span
              key={item.id}
              className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-foreground/75"
            >
              {item.product_name} x{item.quantity}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="flex-1 bg-success/10 text-success hover:bg-success/15 hover:text-success"
          onClick={() => onApprove(order.id)}
          disabled={isApproving || isRejecting}
        >
          <Check />
          Aprovar
        </Button>

        <Popover open={rejectOpen} onOpenChange={setRejectOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className="flex-1 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
              disabled={isApproving || isRejecting}
            >
              <X />
              Rejeitar
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="end">
            <Textarea
              placeholder="Motivo (opcional)"
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              rows={2}
              className="mb-2 text-xs"
            />
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              disabled={isRejecting}
              onClick={() => {
                onReject(order.id, rejectComment || undefined);
                setRejectComment("");
                setRejectOpen(false);
              }}
            >
              Confirmar rejeição
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
