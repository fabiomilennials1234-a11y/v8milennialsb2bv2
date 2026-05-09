import { useState, useMemo } from "react";
import { Plus, Trash2, Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useDealItems, useAddDealItem, useUpdateDealItem, useDeleteDealItem, DealItem } from "@/hooks/useDealItems";
import { useActiveProducts } from "@/hooks/useProducts";
import type { Product } from "@/hooks/useProducts";

interface DealItemsEditorProps {
  dealId: string;
}

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function DealItemsEditor({ dealId }: DealItemsEditorProps) {
  const { data: items = [], isLoading } = useDealItems(dealId);
  const { data: products = [] } = useActiveProducts();
  const addItem = useAddDealItem();
  const updateItem = useUpdateDealItem();
  const deleteItem = useDeleteDealItem();
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (item.total ?? 0), 0),
    [items],
  );

  function handleAddProduct(product: Product) {
    addItem.mutate({
      deal_id: dealId,
      product_id: product.id,
      product_name: product.name,
      quantity: 1,
      unit_price: product.ticket ?? 0,
    });
    setProductPickerOpen(false);
  }

  function handleAddCustom() {
    addItem.mutate({
      deal_id: dealId,
      product_name: "Item personalizado",
      quantity: 1,
      unit_price: 0,
    });
  }

  function handleFieldChange(item: DealItem, field: string, raw: string) {
    const value = parseFloat(raw) || 0;
    updateItem.mutate({ id: item.id, deal_id: dealId, [field]: value });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Package className="h-4 w-4" />
          Itens ({items.length})
        </div>
        <div className="flex items-center gap-2">
          <Popover open={productPickerOpen} onOpenChange={setProductPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="mr-1 h-3.5 w-3.5" /> Produto
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="end">
              <Command>
                <CommandInput placeholder="Buscar produto..." />
                <CommandList>
                  <CommandEmpty>Nenhum produto.</CommandEmpty>
                  <CommandGroup>
                    {products.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={p.name}
                        onSelect={() => handleAddProduct(p)}
                      >
                        <Package className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate">{p.name}</span>
                        {p.ticket != null && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            {formatBRL(p.ticket)}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="sm" onClick={handleAddCustom}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Item livre
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/50 py-8 text-center text-sm text-muted-foreground">
          Nenhum item adicionado
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-[40%]">Produto</TableHead>
                  <TableHead className="text-right w-[12%]">Qtd</TableHead>
                  <TableHead className="text-right w-[18%]">Preco unit.</TableHead>
                  <TableHead className="text-right w-[12%]">Desc %</TableHead>
                  <TableHead className="text-right w-[14%]">Total</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Input
                        defaultValue={item.product_name}
                        onBlur={(e) =>
                          updateItem.mutate({ id: item.id, deal_id: dealId, product_name: e.target.value })
                        }
                        className="h-8 bg-transparent border-0 px-0 focus-visible:ring-1"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={1}
                        defaultValue={item.quantity}
                        onBlur={(e) => handleFieldChange(item, "quantity", e.target.value)}
                        className="h-8 w-16 ml-auto text-right bg-transparent border-0 px-0 focus-visible:ring-1 tabular-nums"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={item.unit_price}
                        onBlur={(e) => handleFieldChange(item, "unit_price", e.target.value)}
                        className="h-8 w-24 ml-auto text-right bg-transparent border-0 px-0 focus-visible:ring-1 tabular-nums"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={item.discount_percent}
                        onBlur={(e) => handleFieldChange(item, "discount_percent", e.target.value)}
                        className="h-8 w-16 ml-auto text-right bg-transparent border-0 px-0 focus-visible:ring-1 tabular-nums"
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatBRL(item.total ?? 0)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteItem.mutate({ id: item.id, deal_id: dealId })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Total row */}
          <div className="flex items-center justify-end gap-4 pr-12">
            <span className="text-sm font-medium text-muted-foreground">Total:</span>
            <span className="text-lg font-bold tabular-nums">{formatBRL(total)}</span>
          </div>
        </>
      )}
    </div>
  );
}
