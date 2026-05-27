import { useState, useCallback } from "react";
import { ShoppingCart, RotateCcw, MessageSquare, CalendarDays, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";

import { ClientChipSelector } from "./ClientChipSelector";
import { ProductCombobox, type ProductSelection } from "./ProductCombobox";
import { OrderItemList } from "./OrderItemList";

import { useNewOrder } from "@/modules/carteira/hooks/useNewOrder";
import { useLastOrder, type OrderLineItem } from "@/modules/carteira/hooks/useQuickOrder";
import { useTeamMembers } from "@/modules/identity";
import { useTinyErpStatus } from "@/modules/carteira/hooks/useTinyErp";
import { TinyErpUpsellConfirmDialog } from "@/modules/carteira/components/upsell/TinyErpUpsellConfirmDialog";

interface NewOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
  clientName?: string;
  campanhaId?: string;
  onComplete?: () => void;
}

export function NewOrderModal({
  open,
  onOpenChange,
  clientId: initialClientId,
  clientName: initialClientName,
  campanhaId,
  onComplete,
}: NewOrderModalProps) {
  const createOrder = useNewOrder();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: tinyStatus } = useTinyErpStatus();

  const [selectedClientId, setSelectedClientId] = useState(initialClientId ?? "");
  const [selectedClientName, setSelectedClientName] = useState(initialClientName ?? "");
  const [items, setItems] = useState<OrderLineItem[]>([]);
  const [closerId, setCloserId] = useState("");
  const [soldAt, setSoldAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const [tinyConfirmOpen, setTinyConfirmOpen] = useState(false);
  const [pendingTinyData, setPendingTinyData] = useState<{
    orderId: string;
    productName: string;
    saleValue: number;
  } | null>(null);

  const effectiveClientId = initialClientId || selectedClientId;
  const { data: lastOrderData, isLoading: loadingLast } = useLastOrder(
    effectiveClientId || "",
  );

  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  const handleClientChange = useCallback((id: string, name: string) => {
    setSelectedClientId(id);
    setSelectedClientName(name);
    setItems([]);
    setPrefilled(false);
  }, []);

  const handleAddProduct = useCallback((product: ProductSelection) => {
    setItems((prev) => [
      ...prev,
      {
        product_id: product.product_id,
        product_name: product.product_name,
        quantity: 1,
        unit_price: product.unit_price,
        unit: product.unit,
      },
    ]);
  }, []);

  const handleChangeItem = useCallback(
    (index: number, field: keyof OrderLineItem, value: string | number) => {
      setItems((prev) =>
        prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
      );
    },
    [],
  );

  const handleRemoveItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

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

  const resetState = () => {
    if (!initialClientId) {
      setSelectedClientId("");
      setSelectedClientName("");
    }
    setItems([]);
    setCloserId("");
    setSoldAt(new Date().toISOString().slice(0, 10));
    setNotes("");
    setShowNotes(false);
    setPrefilled(false);
  };

  const handleSubmit = async () => {
    if (!effectiveClientId) {
      toast.error("Selecione um cliente");
      return;
    }

    const validItems = items.filter(
      (i) => i.product_name.trim() && i.unit_price > 0,
    );

    if (validItems.length === 0) {
      toast.error("Adicione ao menos um item com nome e valor");
      return;
    }

    try {
      const result = await createOrder.mutateAsync({
        clientId: effectiveClientId,
        closerId: closerId || undefined,
        campanhaId: campanhaId || undefined,
        soldAt,
        notes: notes || undefined,
        items: validItems,
        source: "manual",
      });

      toast.success("Pedido registrado com sucesso");

      if (tinyStatus?.connected && result.orderId) {
        setPendingTinyData({
          orderId: result.orderId,
          productName: result.productName,
          saleValue: result.totalValue,
        });
        setTinyConfirmOpen(true);
        return;
      }

      resetState();
      onOpenChange(false);
      onComplete?.();
    } catch (err: any) {
      toast.error("Erro ao registrar pedido: " + (err?.message ?? ""));
    }
  };

  const handleClose = (val: boolean) => {
    if (!val) resetState();
    onOpenChange(val);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[640px] gap-0 p-0 overflow-hidden flex flex-col max-h-[85vh]">
          {/* Header */}
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/40 shrink-0">
            <DialogTitle className="flex items-center gap-2.5 text-base">
              <div className="p-1.5 rounded-lg bg-primary/12">
                <ShoppingCart className="w-4 h-4 text-primary" />
              </div>
              Nova Venda
            </DialogTitle>
          </DialogHeader>

          {/* Body — scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Client selector */}
            <ClientChipSelector
              clientId={initialClientId}
              clientName={initialClientName}
              onChange={handleClientChange}
            />

            {/* Product search + Repeat last */}
            <div className="flex items-center gap-2">
              <ProductCombobox
                onAdd={handleAddProduct}
                disabled={!effectiveClientId}
              />

              {effectiveClientId && lastOrderData && !loadingLast && (
                <button
                  type="button"
                  onClick={handleRepeatLast}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-lg shrink-0",
                    "text-sm font-medium transition-all",
                    prefilled
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      : "bg-muted/40 border border-border/50 hover:border-emerald-500/40 text-muted-foreground hover:text-emerald-400",
                  )}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {prefilled ? "Repetido" : "Repetir último"}
                  </span>
                </button>
              )}
            </div>

            {/* Item list */}
            <OrderItemList
              items={items}
              onChangeItem={handleChangeItem}
              onRemoveItem={handleRemoveItem}
            />

            {/* Metadata row */}
            <div className="flex items-center gap-3 pt-2">
              {/* Responsible */}
              <div className="flex items-center gap-1.5 min-w-0">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Select
                  value={closerId || "none"}
                  onValueChange={(v) => setCloserId(v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-7 w-[140px] text-xs border-transparent bg-transparent hover:bg-muted/40 focus:bg-muted/40">
                    <SelectValue placeholder="Responsável" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date */}
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Input
                  type="date"
                  value={soldAt}
                  onChange={(e) => setSoldAt(e.target.value)}
                  className="h-7 w-[130px] text-xs border-transparent bg-transparent hover:bg-muted/40 focus:bg-muted/40"
                />
              </div>

              {/* Notes toggle */}
              <button
                type="button"
                onClick={() => setShowNotes((v) => !v)}
                className={cn(
                  "h-7 w-7 flex items-center justify-center rounded",
                  "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                  "transition-colors",
                  showNotes && "text-primary bg-primary/10",
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Notes expanded */}
            {showNotes && (
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observações sobre o pedido..."
                rows={2}
                className="text-sm resize-none"
              />
            )}
          </div>

          {/* Sticky footer — total + CTA */}
          <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-border/40 bg-muted/30">
            <div>
              <span
                className={cn(
                  "text-xl font-bold tabular-nums tracking-tight",
                  items.length > 0 ? "text-primary" : "text-muted-foreground/40",
                )}
              >
                {formatBRL(total, 2)}
              </span>
              {items.length > 0 && (
                <span className="text-xs text-muted-foreground ml-2">
                  {items.length} {items.length === 1 ? "item" : "itens"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleClose(false)}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={
                  createOrder.isPending || items.length === 0 || !effectiveClientId
                }
                className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold px-6"
              >
                {createOrder.isPending ? "Registrando..." : "Registrar Venda"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* TinyERP Confirmation */}
      {pendingTinyData && (
        <TinyErpUpsellConfirmDialog
          open={tinyConfirmOpen}
          onOpenChange={setTinyConfirmOpen}
          upsellOrderId={pendingTinyData.orderId}
          client={{ name: selectedClientName || initialClientName || "" }}
          productName={pendingTinyData.productName}
          saleValue={pendingTinyData.saleValue}
          onComplete={() => {
            setPendingTinyData(null);
            resetState();
            onOpenChange(false);
            onComplete?.();
          }}
        />
      )}
    </>
  );
}
