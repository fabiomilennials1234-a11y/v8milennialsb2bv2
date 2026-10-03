import { useState } from "react";
import { Check, ChevronsUpDown, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Product } from "@/modules/carteira/hooks/useProducts";

interface ProductComboboxProps {
  products: Product[];
  value: string;
  onSelect: (productId: string) => void;
  placeholder?: string;
  className?: string;
}

export function ProductCombobox({
  products,
  value,
  onSelect,
  placeholder = "Buscar produto...",
  className,
}: ProductComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = products.find((p) => p.id === value);

  /*
   * `modal` é o que faz a lista ROLAR — este combobox só é usado DENTRO de
   * diálogo (`CreateProposalModal`, e `BudgetFieldBlock` dentro do
   * `DealDetailDialog` e do `CrossPipePanel`).
   *
   * O `Dialog` do Radix monta um `react-remove-scroll` que engole o `wheel` de
   * tudo que estiver FORA do `DialogContent`. O conteúdo do Popover sai por
   * portal para o `body` — fora, portanto — e a roda do mouse não chegava na
   * lista. `modal` dá ao Popover o seu próprio `RemoveScroll` aninhado, e o de
   * dentro é quem passa a mandar.
   *
   * Mesmo conserto da #1862, que cobriu só o combobox de `client/`. Medido aqui
   * com 42 produtos (`scrollHeight` 1436 numa caixa de 300): sem `modal`,
   * `scrollTop` ficava em 0 depois da roda.
   */
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              <Badge
                variant={selected.type === "mrr" ? "default" : "secondary"}
                className="text-xs shrink-0"
              >
                {selected.type === "mrr" ? "Rec." : selected.type === "projeto" ? "Projeto" : "Unit."}
              </Badge>
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Package className="w-4 h-4 shrink-0" />
              {placeholder}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* `z-[70]` porque a lista tem de pintar acima da superfície que a abriu:
          no celular o `DealDetailDialog` vira `SheetContent`, que é `z-[51]`.
          No `z-50` do primitivo a lista nasce ATRÁS da folha. */}
      <PopoverContent
        className="z-[70] w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Digitar nome ou SKU..." />
          <CommandList>
            <CommandEmpty>Nenhum produto encontrado.</CommandEmpty>
            <CommandGroup>
              {products.map((product) => (
                <CommandItem
                  key={product.id}
                  value={`${product.name} ${product.sku || ""}`}
                  onSelect={() => {
                    onSelect(product.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === product.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant={product.type === "mrr" ? "default" : "secondary"}
                      className="text-xs shrink-0"
                    >
                      {product.type === "mrr" ? "Rec." : product.type === "projeto" ? "Projeto" : "Unit."}
                    </Badge>
                    <span className="truncate">{product.name}</span>
                    {product.sku && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {product.sku}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
