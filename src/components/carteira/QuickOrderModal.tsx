import { useState, useCallback } from "react";
import { Plus, X, RotateCcw, ShoppingBag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useProducts } from "@/hooks/useProducts";
import { useLastOrder, useCreateOrder, OrderLineItem } from "@/hooks/useQuickOrder";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

interface QuickOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
  clientName?: string;
}

const UNITS = ["un", "kg", "l", "m", "cx", "pc"] as const;

const DEFAULT_ITEM: OrderLineItem = {
  product_name: "",
  quantity: 1,
  unit_price: 0,
  unit: "un",
};

function LineItemRow({
  item,
  index,
  products,
  onChange,
  onRemove,
  showRemove,
}: {
  item: OrderLineItem;
  index: number;
  products: { id: string; name: string }[];
  onChange: (index: number, field: keyof OrderLineItem, value: string | number) => void;
  onRemove: (index: number) => void;
  showRemove: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_80px_100px_80px_32px] gap-2 items-center">
      {/* Product name — combobox if products available, plain input otherwise */}
      {products.length > 0 ? (
        <Select
          value={item.product_id ?? "__custom__"}
          onValueChange={(val) => {
            if (val === "__custom__") {
              onChange(index, "product_id", "");
              onChange(index, "product_name", "");
            } else {
              const p = products.find((x) => x.id === val);
              if (p) {
                onChange(index, "product_id", p.id);
                onChange(index, "product_name", p.name);
              }
            }
          }}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Produto..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__custom__">— Personalizado —</SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          className="h-8 text-sm"
          placeholder="Nome do produto"
          value={item.product_name}
          onChange={(e) => onChange(index, "product_name", e.target.value)}
        />
      )}

      {/* Custom product name override when "custom" selected */}
      {products.length > 0 && !item.product_id && (
        <div className="col-span-5 -mt-1">
          <Input
            className="h-8 text-sm"
            placeholder="Nome do produto personalizado"
            value={item.product_name}
            onChange={(e) => onChange(index, "product_name", e.target.value)}
          />
        </div>
      )}

      <Input
        className="h-8 text-sm text-right"
        type="number"
        min={1}
        value={item.quantity}
        onChange={(e) => onChange(index, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
      />

      <Input
        className="h-8 text-sm text-right"
        type="number"
        min={0}
        step={0.01}
        value={item.unit_price === 0 ? "" : item.unit_price}
        placeholder="0,00"
        onChange={(e) => onChange(index, "unit_price", parseFloat(e.target.value) || 0)}
      />

      <Select
        value={item.unit}
        onValueChange={(v) => onChange(index, "unit", v)}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNITS.map((u) => (
            <SelectItem key={u} value={u}>
              {u}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7 text-muted-foreground hover:text-destructive",
          !showRemove && "invisible",
        )}
        onClick={() => onRemove(index)}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function QuickOrderModal({
  open,
  onOpenChange,
  clientId,
  clientName,
}: QuickOrderModalProps) {
  const { data: products = [] } = useProducts();
  const activeProducts = products.filter((p) => p.is_active);

  const { data: lastOrderData, isLoading: loadingLast } = useLastOrder(clientId ?? "");
  const createOrder = useCreateOrder();

  const [items, setItems] = useState<OrderLineItem[]>([{ ...DEFAULT_ITEM }]);
  const [prefilled, setPrefilled] = useState(false);

  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  const handleChange = useCallback(
    (index: number, field: keyof OrderLineItem, value: string | number) => {
      setItems((prev) =>
        prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
      );
    },
    [],
  );

  const handleRemove = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddItem = () => {
    setItems((prev) => [...prev, { ...DEFAULT_ITEM }]);
  };

  const handleRepeatLast = () => {
    if (!lastOrderData) return;

    if (lastOrderData.items.length > 0) {
      setItems(
        lastOrderData.items.map((it: any) => ({
          product_id: it.product_id ?? undefined,
          product_name: it.product_name ?? "",
          quantity: it.quantity ?? 1,
          unit_price: it.unit_price ?? 0,
          unit: it.unit ?? "un",
        })),
      );
    } else {
      // Fallback: single item from order header
      setItems([
        {
          product_name: lastOrderData.order.product_name ?? "Produto",
          quantity: 1,
          unit_price: lastOrderData.order.sale_value ?? 0,
          unit: "un",
        },
      ]);
    }
    setPrefilled(true);
  };

  const handleConfirm = async () => {
    if (!clientId) return;

    const validItems = items.filter((i) => i.product_name.trim() && i.unit_price > 0);
    if (validItems.length === 0) {
      toast.error("Adicione ao menos um item com nome e valor");
      return;
    }

    try {
      await createOrder.mutateAsync({
        clientId,
        items: validItems,
        source: "manual",
      });
      toast.success("Pedido registrado com sucesso");
      setItems([{ ...DEFAULT_ITEM }]);
      setPrefilled(false);
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao registrar pedido: " + (err?.message ?? ""));
    }
  };

  const handleClose = (val: boolean) => {
    if (!val) {
      setItems([{ ...DEFAULT_ITEM }]);
      setPrefilled(false);
    }
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[620px] gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="p-1.5 rounded-lg bg-[hsl(47_100%_50%/0.12)]">
              <ShoppingBag className="w-4 h-4 text-[hsl(47_100%_50%)]" />
            </div>
            Novo Pedido
            {clientName && (
              <span className="text-muted-foreground font-normal">— {clientName}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          {/* Repeat last order card */}
          {lastOrderData && !loadingLast && (
            <button
              type="button"
              onClick={handleRepeatLast}
              className={cn(
                "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-all",
                "bg-emerald-950/30 border-emerald-800/40 hover:border-emerald-600/60 hover:bg-emerald-950/50",
                prefilled && "border-emerald-500/60 bg-emerald-950/50",
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <RotateCcw className="h-4 w-4 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-emerald-300">Repetir Ultimo Pedido</p>
                  <p className="text-xs text-emerald-500/80 truncate">
                    {lastOrderData.order.product_name} ·{" "}
                    {formatBRL(lastOrderData.order.sale_value ?? 0)}
                  </p>
                </div>
              </div>
              {prefilled && (
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 text-emerald-400 text-[10px] shrink-0"
                >
                  Preenchido
                </Badge>
              )}
            </button>
          )}

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_80px_100px_80px_32px] gap-2 px-0.5">
            <span className="text-xs text-muted-foreground">Produto</span>
            <span className="text-xs text-muted-foreground text-right">Qtd</span>
            <span className="text-xs text-muted-foreground text-right">Preco unit.</span>
            <span className="text-xs text-muted-foreground">Unidade</span>
            <span />
          </div>

          {/* Line items */}
          <div className="space-y-2">
            {items.map((item, i) => (
              <LineItemRow
                key={i}
                item={item}
                index={i}
                products={activeProducts}
                onChange={handleChange}
                onRemove={handleRemove}
                showRemove={items.length > 1}
              />
            ))}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-1.5 -ml-1"
            onClick={handleAddItem}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar item
          </Button>

          {/* Total */}
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-lg font-semibold text-[hsl(47_100%_50%)]">
              {formatBRL(total)}
            </span>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/50 gap-2">
          <Button variant="ghost" onClick={() => handleClose(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={createOrder.isPending}
            className="bg-[hsl(47_100%_50%)] text-black hover:bg-[hsl(47_100%_45%)] font-semibold"
          >
            {createOrder.isPending ? "Registrando..." : "Confirmar Pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
