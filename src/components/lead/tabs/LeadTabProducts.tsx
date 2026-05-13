import { useState } from "react";
import { Package, Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useLeadProducts,
  useAddLeadProduct,
  useUpdateLeadProduct,
  useRemoveLeadProduct,
  type LeadProduct,
} from "@/hooks/useLeadProducts";
import { useProducts } from "@/hooks/useProducts";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function daysSince(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function isOverdue(lp: LeadProduct): boolean {
  if (!lp.avg_cycle_days || !lp.last_purchased_at) return false;
  const days = daysSince(lp.last_purchased_at);
  return days !== null && days > lp.avg_cycle_days * 1.3;
}

interface LeadTabProductsProps {
  leadId: string;
}

export function LeadTabProducts({ leadId }: LeadTabProductsProps) {
  const { data: leadProducts = [], isLoading } = useLeadProducts(leadId);
  const { data: products = [] } = useProducts();
  const addProduct = useAddLeadProduct();
  const updateProduct = useUpdateLeadProduct();
  const removeProduct = useRemoveLeadProduct();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [value, setValue] = useState("");

  const handleAdd = () => {
    if (!selectedProductId) return;
    const product = products.find((p) => p.id === selectedProductId);
    addProduct.mutate(
      {
        leadId,
        productId: selectedProductId,
        productName: product?.name ?? "",
        quantity: parseFloat(qty) || 0,
        value: parseFloat(value) || 0,
      },
      {
        onSuccess: () => {
          setAddOpen(false);
          setSelectedProductId("");
          setQty("1");
          setValue("");
        },
      }
    );
  };

  const existingProductIds = new Set(leadProducts.map((lp) => lp.product_id));
  const availableProducts = products.filter(
    (p) => p.is_active !== false && !existingProductIds.has(p.id)
  );

  if (isLoading) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-4">
      {leadProducts.length === 0 ? (
        <div className="text-center py-6">
          <Package className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Nenhum produto vinculado</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Qtd total</TableHead>
              <TableHead className="text-right">Valor total</TableHead>
              <TableHead>Última compra</TableHead>
              <TableHead>Ciclo</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leadProducts.map((lp) => {
              const overdue = isOverdue(lp);
              const daysSinceLast = daysSince(lp.last_purchased_at);
              return (
                <TableRow key={lp.id} className={overdue ? "bg-amber-500/5" : ""}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {lp.product?.name ?? "—"}
                      {overdue && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{lp.quantity_total}</TableCell>
                  <TableCell className="text-right">{fmt(lp.revenue_total)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {lp.last_purchased_at
                      ? `${new Date(lp.last_purchased_at).toLocaleDateString("pt-BR")} (${daysSinceLast}d)`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {lp.avg_cycle_days ? `${lp.avg_cycle_days}d` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={lp.status === "active" ? "default" : "secondary"}
                      className="cursor-pointer text-[10px]"
                      onClick={() =>
                        updateProduct.mutate({
                          id: lp.id,
                          leadId,
                          status: lp.status === "active" ? "inactive" : "active",
                        })
                      }
                    >
                      {lp.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> Adicionar produto
      </Button>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Vincular produto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Produto</Label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar" />
                </SelectTrigger>
                <SelectContent>
                  {availableProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade</Label>
                <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} min={0} />
              </div>
              <div>
                <Label>Valor (R$)</Label>
                <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} min={0} step={0.01} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={!selectedProductId || addProduct.isPending}>
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
