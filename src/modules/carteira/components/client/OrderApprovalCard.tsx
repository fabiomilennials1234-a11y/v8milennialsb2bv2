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

const SOURCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  copilot: { bg: "bg-[#2a2a3a]", text: "text-[#8b8bff]", label: "Copilot" },
  manual: { bg: "bg-[#2a2a1a]", text: "text-[#fbbf24]", label: "Manual" },
  pipe: { bg: "bg-[#1a2a2a]", text: "text-[#2dd4bf]", label: "Pipe" },
  erp: { bg: "bg-[#1a2a3a]", text: "text-[#60a5fa]", label: "ERP" },
  csv_import: { bg: "bg-[#2a2a2a]", text: "text-muted-foreground", label: "CSV" },
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
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      {/* Header: client + value */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {order.client_name}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dateStr}
            {" · "}
            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", source.bg, source.text)}>
              {source.label}
            </span>
          </p>
        </div>
        <span className="text-base font-bold text-primary">{valueStr}</span>
      </div>

      {/* Items chips */}
      {order.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {order.items.map((item) => (
            <span
              key={item.id}
              className="bg-muted px-2.5 py-0.5 rounded text-[11px] text-muted-foreground"
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
          className="flex-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
          onClick={() => onApprove(order.id)}
          disabled={isApproving || isRejecting}
        >
          <Check className="w-4 h-4 mr-1.5" />
          Aprovar
        </Button>

        <Popover open={rejectOpen} onOpenChange={setRejectOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className="flex-1 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300"
              disabled={isApproving || isRejecting}
            >
              <X className="w-4 h-4 mr-1.5" />
              Rejeitar
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="end">
            <Textarea
              placeholder="Motivo (opcional)"
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              rows={2}
              className="text-xs mb-2"
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
