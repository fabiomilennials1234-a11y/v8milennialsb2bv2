import { X, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { OrderLineItem } from "@/hooks/useQuickOrder";

interface OrderItemListProps {
  items: OrderLineItem[];
  onChangeItem: (index: number, field: keyof OrderLineItem, value: string | number) => void;
  onRemoveItem: (index: number) => void;
}

export function OrderItemList({
  items,
  onChangeItem,
  onRemoveItem,
}: OrderItemListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <ShoppingCart className="h-8 w-8 mb-2 opacity-30" />
        <span className="text-sm">Busque um produto acima para adicionar</span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {items.map((item, index) => {
        const subtotal = item.quantity * item.unit_price;
        return (
          <div
            key={index}
            className={cn(
              "group flex items-center gap-3 px-3 py-2 rounded-lg",
              "hover:bg-muted/50 transition-colors",
            )}
          >
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium truncate block">
                {item.product_name}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) =>
                  onChangeItem(
                    index,
                    "quantity",
                    Math.max(1, parseInt(e.target.value) || 1),
                  )
                }
                className={cn(
                  "w-14 h-7 text-right text-sm bg-transparent rounded px-1.5",
                  "border border-transparent focus:border-border focus:bg-muted/40",
                  "outline-none transition-colors",
                )}
              />
              <span className="text-xs text-muted-foreground">×</span>
            </div>

            <div className="shrink-0">
              <input
                type="number"
                min={0}
                step={0.01}
                value={item.unit_price === 0 ? "" : item.unit_price}
                placeholder="0,00"
                onChange={(e) =>
                  onChangeItem(
                    index,
                    "unit_price",
                    parseFloat(e.target.value) || 0,
                  )
                }
                className={cn(
                  "w-24 h-7 text-right text-sm bg-transparent rounded px-1.5",
                  "border border-transparent focus:border-border focus:bg-muted/40",
                  "outline-none transition-colors",
                )}
              />
            </div>

            <span className="text-sm text-muted-foreground w-24 text-right shrink-0 tabular-nums">
              {formatBRL(subtotal, 2)}
            </span>

            <button
              type="button"
              onClick={() => onRemoveItem(index)}
              className={cn(
                "h-6 w-6 flex items-center justify-center rounded",
                "text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10",
                "opacity-0 group-hover:opacity-100 transition-all shrink-0",
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
