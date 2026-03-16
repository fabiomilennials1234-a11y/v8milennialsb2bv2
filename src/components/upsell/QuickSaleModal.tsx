import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateUpsellOrder } from "@/hooks/useUpsellOrders";
import { useOrganization } from "@/hooks/useOrganization";
import { useProducts } from "@/hooks/useProducts";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useTinyErpStatus } from "@/hooks/useTinyErp";
import { TinyErpUpsellConfirmDialog } from "./TinyErpUpsellConfirmDialog";
import { toast } from "sonner";

interface QuickSaleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  campanhaId?: string;
  onSaleComplete?: () => void;
}

export function QuickSaleModal({
  open,
  onOpenChange,
  clientId,
  clientName,
  campanhaId,
  onSaleComplete,
}: QuickSaleModalProps) {
  const { organizationId } = useOrganization();
  const createOrder = useCreateUpsellOrder();
  const { data: products = [] } = useProducts();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: tinyStatus } = useTinyErpStatus();
  const activeProducts = products.filter((p) => p.is_active);

  // TinyERP confirmation state
  const [tinyConfirmOpen, setTinyConfirmOpen] = useState(false);
  const [pendingTinyData, setPendingTinyData] = useState<{
    orderId: string;
    productName: string;
    saleValue: number;
  } | null>(null);

  const [formData, setFormData] = useState({
    product_id: "",
    product_name: "",
    product_type: "mrr" as string,
    sale_value: "",
    closer_id: "",
    notes: "",
  });

  const handleProductChange = (productId: string) => {
    const product = activeProducts.find((p) => p.id === productId);
    if (product) {
      setFormData((prev) => ({
        ...prev,
        product_id: productId,
        product_name: product.name,
        product_type: product.type,
        sale_value: product.ticket ? String(product.ticket) : prev.sale_value,
      }));
    }
  };

  const handleSubmit = async () => {
    if (!organizationId) return;

    const saleValue = parseFloat(formData.sale_value);
    if (isNaN(saleValue) || saleValue <= 0) {
      toast.error("Informe um valor de venda valido");
      return;
    }

    if (!formData.product_name) {
      toast.error("Selecione ou informe o produto");
      return;
    }

    try {
      const orderData = await createOrder.mutateAsync({
        order: {
          organization_id: organizationId,
          client_id: clientId,
          closer_id: formData.closer_id || null,
          product_id: formData.product_id || null,
          product_name: formData.product_name,
          product_type: formData.product_type,
          sale_value: saleValue,
          origin: "upsell",
          campanha_id: campanhaId || null,
          notes: formData.notes || null,
        },
        clientProduct: {
          client_id: clientId,
          product_id: formData.product_id || null,
          product_name: formData.product_name,
          product_type: formData.product_type,
          sale_value: saleValue,
        },
      });

      toast.success("Venda registrada com sucesso!");

      // If TinyERP is connected, show confirmation dialog
      if (tinyStatus?.connected && orderData?.id) {
        setPendingTinyData({
          orderId: orderData.id,
          productName: formData.product_name,
          saleValue,
        });
        setTinyConfirmOpen(true);
        return;
      }

      onOpenChange(false);
      onSaleComplete?.();
      setFormData({
        product_id: "",
        product_name: "",
        product_type: "mrr",
        sale_value: "",
        closer_id: "",
        notes: "",
      });
    } catch (err: any) {
      toast.error("Erro ao registrar venda: " + (err?.message || ""));
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-green-500/10">
              <ShoppingCart className="w-4 h-4 text-green-600" />
            </div>
            Venda Rapida
          </DialogTitle>
          <DialogDescription>
            Registrar venda para <strong>{clientName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Produto</Label>
            <Select value={formData.product_id} onValueChange={handleProductChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um produto..." />
              </SelectTrigger>
              <SelectContent>
                {activeProducts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={formData.sale_value}
                onChange={(e) => setFormData((prev) => ({ ...prev, sale_value: e.target.value }))}
                placeholder="0,00"
              />
            </div>
            <div className="grid gap-2">
              <Label>Tipo</Label>
              <Select
                value={formData.product_type}
                onValueChange={(v) => setFormData((prev) => ({ ...prev, product_type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mrr">MRR</SelectItem>
                  <SelectItem value="projeto">Projeto</SelectItem>
                  <SelectItem value="unitario">Unitario</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Responsável</Label>
            <Select
              value={formData.closer_id || "none"}
              onValueChange={(v) => setFormData((prev) => ({ ...prev, closer_id: v === "none" ? "" : v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {teamMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Observacoes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Notas sobre a venda..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={createOrder.isPending}>
            {createOrder.isPending ? "Registrando..." : "Registrar Venda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* TinyERP Confirmation Dialog */}
    {pendingTinyData && (
      <TinyErpUpsellConfirmDialog
        open={tinyConfirmOpen}
        onOpenChange={setTinyConfirmOpen}
        upsellOrderId={pendingTinyData.orderId}
        client={{ name: clientName }}
        productName={pendingTinyData.productName}
        saleValue={pendingTinyData.saleValue}
        onComplete={() => {
          setPendingTinyData(null);
          onOpenChange(false);
          onSaleComplete?.();
          setFormData({
            product_id: "",
            product_name: "",
            product_type: "mrr",
            sale_value: "",
            closer_id: "",
            notes: "",
          });
        }}
      />
    )}
    </>
  );
}
