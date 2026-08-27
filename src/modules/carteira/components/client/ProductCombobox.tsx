import { useState, useRef } from "react";
import { Search, Plus, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProducts } from "@/modules/carteira/hooks/useProducts";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ProductSelection {
  product_id?: string;
  product_name: string;
  unit_price: number;
  unit: string;
}

interface ProductComboboxProps {
  onAdd: (product: ProductSelection) => void;
  disabled?: boolean;
}

export function ProductCombobox({ onAdd, disabled }: ProductComboboxProps) {
  const { data: products = [] } = useProducts();
  const activeProducts = products.filter((p) => p.is_active);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const hasProducts = activeProducts.length > 0;

  const handleSelectProduct = (productId: string) => {
    const product = activeProducts.find((p) => p.id === productId);
    if (!product) return;

    onAdd({
      product_id: product.id,
      product_name: product.name,
      unit_price: product.ticket ?? 0,
      unit: "un",
    });

    setSearch("");
    setOpen(false);
  };

  const handleAddCustom = () => {
    if (!search.trim()) return;

    onAdd({
      product_name: search.trim(),
      unit_price: 0,
      unit: "un",
    });

    setSearch("");
    setOpen(false);
  };

  if (!hasProducts) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAddCustom();
        }}
        className="flex-1"
      >
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg",
            "bg-muted/40 border border-border/50 focus-within:border-border",
            "transition-colors",
          )}
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Digite o nome do produto..."
            disabled={disabled}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCustom();
              }
            }}
          />
          {/*
            O botão existe porque o Enter era o ÚNICO jeito de confirmar, e nada
            na tela dizia isso. Quem digitava o nome e ia direto no botão de
            baixo não lançava nada: o pai só sabe do produto depois do `onAdd`,
            então para ele nada tinha sido escolhido e o botão final ficava
            desabilitado — mudo, sem dizer o que faltava.
          */}
          <button
            type="submit"
            disabled={disabled || !search.trim()}
            title="Usar este nome"
            aria-label="Usar este nome"
            className={cn(
              "shrink-0 rounded-md p-1 text-muted-foreground transition-colors",
              "hover:text-foreground disabled:opacity-40 disabled:pointer-events-none",
            )}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </form>
    );
  }

  const filtered = search
    ? activeProducts.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()),
      )
    : activeProducts;

  const showCustomOption = search.trim() && filtered.length === 0;

  /*
   * `modal` é o que faz a lista ROLAR quando o combobox está dentro de um
   * diálogo — e é o caso de todos os usos de hoje (NewOrderModal,
   * EditOrderDialog, CreateProposalModal e "Adicionar produto" do Negócio).
   *
   * O `Dialog` do Radix monta um `react-remove-scroll`, que engole o evento
   * `wheel` de tudo que estiver FORA do `DialogContent`. O conteúdo do Popover
   * sai por portal para o `body`, ou seja, fora — então a roda do mouse não
   * chegava na lista. `modal` dá ao Popover o seu próprio `RemoveScroll`
   * aninhado, e o de dentro é quem passa a mandar.
   *
   * Medido em navegador com 42 produtos (`scrollHeight` 1520 para uma caixa de
   * 300): sem `modal`, `scrollTop` ficava em 0 depois da roda; com `modal`, foi
   * a 600. Forçar `el.scrollTop` por script funcionava nos dois casos — o
   * elemento sempre pôde rolar, o que faltava era o evento chegar nele.
   */
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex items-center gap-2 flex-1 px-3 py-2 rounded-lg",
            "bg-muted/40 border border-border/50 hover:border-border",
            "text-sm text-muted-foreground transition-colors",
            "disabled:opacity-50 disabled:pointer-events-none",
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          Buscar produto...
        </button>
      </PopoverTrigger>
      {/* `z-[70]` porque a lista tem de pintar acima da superfície que a abriu,
          e algumas delas já sobem para `z-[60]` para vencer o `SheetContent`
          (`z-[51]`) no celular. No `z-50` do primitivo, a lista de produtos
          nasceria ATRÁS do próprio diálogo que a pediu. */}
      <PopoverContent
        className="z-[70] w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Nome do produto..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {filtered.length === 0 && !showCustomOption && (
              <CommandEmpty>Nenhum produto encontrado</CommandEmpty>
            )}
            <CommandGroup>
              {filtered.map((p) => (
                <CommandItem
                  key={p.id}
                  onSelect={() => handleSelectProduct(p.id)}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{p.name}</span>
                  </div>
                  {p.ticket != null && p.ticket > 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      R$ {p.ticket.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </CommandItem>
              ))}
              {showCustomOption && (
                <CommandItem
                  onSelect={handleAddCustom}
                  className="flex items-center gap-2 py-2 text-primary"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-sm">
                    Adicionar "{search.trim()}" como avulso
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
