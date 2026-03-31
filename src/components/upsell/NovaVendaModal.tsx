import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateUpsellOrder } from "@/hooks/useUpsellOrders";
import { useUpsellClients } from "@/hooks/useUpsellClients";
import { useOrganization } from "@/hooks/useOrganization";
import { useProducts } from "@/hooks/useProducts";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useTinyErpStatus } from "@/hooks/useTinyErp";
import { TinyErpUpsellConfirmDialog } from "./TinyErpUpsellConfirmDialog";
import { toast } from "sonner";

interface NovaVendaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const initialForm = {
  client_id: "",
  product_id: "",
  product_name: "",
  product_type: "mrr" as string,
  sale_value: "",
  closer_id: "",
  sold_at: new Date().toISOString().slice(0, 10),
  notes: "",
};

export function NovaVendaModal({ open, onOpenChange }: NovaVendaModalProps) {
  const { organizationId } = useOrganization();
  const createOrder = useCreateUpsellOrder();
  const { data: clients = [] } = useUpsellClients();
  const { data: products = [] } = useProducts();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: tinyStatus } = useTinyErpStatus();

  const activeClients = clients.filter((c) => c.is_active);
  const activeProducts = products.filter((p) => p.is_active);

  const [formData, setFormData] = useState(initialForm);
  const [clientSearch, setClientSearch] = useState("");

  // TinyERP confirmation state
  const [tinyConfirmOpen, setTinyConfirmOpen] = useState(false);
  const [pendingTinyData, setPendingTinyData] = useState<{
    orderId: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    productName: string;
    saleValue: number;
  } | null>(null);

  const filteredClients = clientSearch
    ? activeClients.filter(
        (c) =>
          c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
          (c.company || "").toLowerCase().includes(clientSearch.toLowerCase())
      )
    : activeClients;

  const selectedClient = activeClients.find((c) => c.id === formData.client_id);

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

    if (!formData.client_id) {
      toast.error("Selecione um cliente");
      return;
    }

    if (!formData.product_name) {
      toast.error("Selecione ou informe o produto");
      return;
    }

    const saleValue = parseFloat(formData.sale_value);
    if (isNaN(saleValue) || saleValue <= 0) {
      toast.error("Informe um valor de venda valido");
      return;
    }

    try {
      const orderData = await createOrder.mutateAsync({
        order: {
          organization_id: organizationId,
          client_id: formData.client_id,
          closer_id: formData.closer_id || null,
          product_id: formData.product_id || null,
          product_name: formData.product_name,
          product_type: formData.product_type,
          sale_value: saleValue,
          origin: "upsell",
          sold_at: new Date(formData.sold_at + "T12:00:00").toISOString(),
          notes: formData.notes || null,
        },
        clientProduct: {
          client_id: formData.client_id,
          product_id: formData.product_id || null,
          product_name: formData.product_name,
          product_type: formData.product_type,
          sale_value: saleValue,
        },
      });

      toast.success("Venda registrada com sucesso!");

      // If TinyERP is connected, show confirmation dialog to push order
      if (tinyStatus?.connected && orderData?.id) {
        const client = activeClients.find((c) => c.id === formData.client_id);
        setPendingTinyData({
          orderId: orderData.id,
          clientName: client?.name || "",
          clientEmail: client?.email || "",
          clientPhone: client?.phone || "",
          productName: formData.product_name,
          saleValue,
        });
        setTinyConfirmOpen(true);
        // Don't close the main modal yet — TinyERP dialog will handle it
        return;
      }

      onOpenChange(false);
      setFormData({ ...initialForm, sold_at: new Date().toISOString().slice(0, 10) });
      setClientSearch("");
    } catch (err: any) {
      toast.error("Erro ao registrar venda: " + (err?.message || ""));
    }
  };

  const handleOpenChange = (value: boolean) => {
    onOpenChange(value);
    if (!value) {
      setFormData({ ...initialForm, sold_at: new Date().toISOString().slice(0, 10) });
      setClientSearch("");
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-green-500/10">
              <ShoppingCart className="w-4 h-4 text-green-600" />
            </div>
            Nova Venda
          </DialogTitle>
          <DialogDescription>
            Registre uma nova venda para um cliente da carteira
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Cliente */}
          <div className="grid gap-2">
            <Label>Cliente *</Label>
            <Select value={formData.client_id} onValueChange={(v) => setFormData((prev) => ({ ...prev, client_id: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um cliente..." />
              </SelectTrigger>
              <SelectContent>
                <div className="px-2 pb-2">
                  <Input
                    placeholder="Buscar cliente..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    className="h-8 text-sm"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                {filteredClients.length === 0 && (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    Nenhum cliente encontrado
                  </div>
                )}
                {filteredClients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <div className="flex flex-col">
                      <span>{c.name}</span>
                      {c.company && (
                        <span className="text-xs text-muted-foreground">{c.company}</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedClient && (
              <p className="text-xs text-muted-foreground">
                {selectedClient.company && `${selectedClient.company} · `}
                {selectedClient.potencial}
              </p>
            )}
          </div>

          {/* Produto */}
          <div className="grid gap-2">
            <Label>Produto *</Label>
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

          {/* Valor + Tipo */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Valor (R$) *</Label>
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
                  <SelectItem value="mrr">Recorrência</SelectItem>
                  <SelectItem value="projeto">Projeto</SelectItem>
                  <SelectItem value="unitario">Unitario</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Responsável + Data */}
          <div className="grid grid-cols-2 gap-4">
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
              <Label>Data da venda</Label>
              <Input
                type="date"
                value={formData.sold_at}
                onChange={(e) => setFormData((prev) => ({ ...prev, sold_at: e.target.value }))}
              />
            </div>
          </div>

          {/* Notas */}
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
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancelar
          </Button>
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
        client={{
          name: pendingTinyData.clientName,
          email: pendingTinyData.clientEmail,
          phone: pendingTinyData.clientPhone,
        }}
        productName={pendingTinyData.productName}
        saleValue={pendingTinyData.saleValue}
        onComplete={() => {
          setPendingTinyData(null);
          onOpenChange(false);
          setFormData({ ...initialForm, sold_at: new Date().toISOString().slice(0, 10) });
          setClientSearch("");
        }}
      />
    )}
    </>
  );
}
