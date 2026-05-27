import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useProducts } from "@/modules/carteira/hooks/useProducts";
import { useDealItems, useCreateDealItem, useUpdateDealItem, useDeleteDealItem } from "@/modules/carteira/hooks/useDealItems";
import { useOrganization } from "@/modules/identity";
import type { DealItemRow } from "@/modules/carteira/hooks/useDeals";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  dealId: string;
}

export function DealItemsTable({ dealId }: Props) {
  const { organizationId } = useOrganization();
  const { data: items = [] } = useDealItems(dealId);
  const { data: products = [] } = useProducts();
  const createItem = useCreateDealItem();
  const updateItem = useUpdateDealItem();
  const deleteItem = useDeleteDealItem();

  const [adding, setAdding] = useState(false);
  const [newProductId, setNewProductId] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newPrice, setNewPrice] = useState("");
  const [newDiscount, setNewDiscount] = useState("0");

  const handleAdd = () => {
    if (!newProductId || !organizationId) return;
    const product = products.find((p) => p.id === newProductId);
    createItem.mutate(
      {
        deal_id: dealId,
        product_id: newProductId,
        product_name: product?.name ?? "Produto",
        quantity: parseFloat(newQty) || 1,
        unit_price: parseFloat(newPrice) || product?.ticket || 0,
        discount_percent: parseFloat(newDiscount) || 0,
        sort_order: items.length,
        organization_id: organizationId,
      },
      {
        onSuccess: () => {
          setAdding(false);
          setNewProductId("");
          setNewQty("1");
          setNewPrice("");
          setNewDiscount("0");
        },
      }
    );
  };

  const handleFieldUpdate = (item: DealItemRow, field: string, value: string) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;
    updateItem.mutate({ id: item.id, [field]: numValue });
  };

  const total = items.reduce((sum, i) => sum + (i.total ?? 0), 0);

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">Produto</TableHead>
            <TableHead className="w-[12%]">Qtd</TableHead>
            <TableHead className="w-[18%]">Preço unit.</TableHead>
            <TableHead className="w-[12%]">Desc. %</TableHead>
            <TableHead className="w-[14%] text-right">Total</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.product_name}</TableCell>
              <TableCell>
                <Input
                  type="number"
                  defaultValue={item.quantity}
                  min={0.01}
                  step={0.01}
                  className="h-8 w-20"
                  onBlur={(e) => handleFieldUpdate(item, "quantity", e.target.value)}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  defaultValue={item.unit_price}
                  min={0}
                  step={0.01}
                  className="h-8 w-28"
                  onBlur={(e) => handleFieldUpdate(item, "unit_price", e.target.value)}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  defaultValue={item.discount_percent}
                  min={0}
                  max={100}
                  className="h-8 w-20"
                  onBlur={(e) => handleFieldUpdate(item, "discount_percent", e.target.value)}
                />
              </TableCell>
              <TableCell className="text-right font-medium">{fmt(item.total)}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => deleteItem.mutate({ id: item.id, dealId })}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {adding && (
            <TableRow>
              <TableCell>
                <Select value={newProductId} onValueChange={(v) => {
                  setNewProductId(v);
                  const p = products.find((pr) => pr.id === v);
                  if (p?.ticket) setNewPrice(String(p.ticket));
                }}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Selecionar produto" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.filter((p) => p.is_active !== false).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input type="number" value={newQty} onChange={(e) => setNewQty(e.target.value)} className="h-8 w-20" min={0.01} step={0.01} />
              </TableCell>
              <TableCell>
                <Input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="h-8 w-28" min={0} step={0.01} />
              </TableCell>
              <TableCell>
                <Input type="number" value={newDiscount} onChange={(e) => setNewDiscount(e.target.value)} className="h-8 w-20" min={0} max={100} />
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" className="h-8" onClick={handleAdd} disabled={!newProductId || createItem.isPending}>
                  OK
                </Button>
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {items.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="font-semibold">Total</TableCell>
              <TableCell className="text-right font-semibold">{fmt(total)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        )}
      </Table>

      {!adding && (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar produto
        </Button>
      )}
    </div>
  );
}
