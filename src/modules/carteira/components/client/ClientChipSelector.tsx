import { useState, useRef, useEffect } from "react";
import { X, Search, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpsellClients } from "@/modules/carteira/hooks/useUpsellClients";
import { erpLabel } from "@/shared/format/erp-code";
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

interface ClientChipSelectorProps {
  clientId?: string;
  clientName?: string;
  onChange: (clientId: string, clientName: string) => void;
}

export function ClientChipSelector({
  clientId,
  clientName,
  onChange,
}: ClientChipSelectorProps) {
  const { data: clients = [] } = useUpsellClients();
  // Inclui o cliente JÁ selecionado mesmo se estiver inativo: ao editar um
  // pedido de cliente inativo, filtrar só por `is_active` fazia o seletor não
  // encontrar o próprio cliente do pedido — o chip abria vazio e salvar movia a
  // receita sem querer. Inativo não aparece para escolha nova, só se já é o
  // selecionado.
  const activeClients = clients.filter((c) => c.is_active || c.id === clientId);

  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(clientId ?? "");
  const [selectedName, setSelectedName] = useState(clientName ?? "");
  const [selectedCompany, setSelectedCompany] = useState("");

  useEffect(() => {
    if (clientId && !selectedName) {
      const client = activeClients.find((c) => c.id === clientId);
      if (client) {
        setSelectedId(client.id);
        setSelectedName(client.name);
        setSelectedCompany(client.company ?? "");
      }
    }
  }, [clientId, activeClients, selectedName]);

  const handleSelect = (id: string) => {
    const client = activeClients.find((c) => c.id === id);
    if (!client) return;
    setSelectedId(client.id);
    setSelectedName(client.name);
    setSelectedCompany(client.company ?? "");
    setOpen(false);
    onChange(client.id, client.name);
  };

  const handleClear = () => {
    setSelectedId("");
    setSelectedName("");
    setSelectedCompany("");
    setOpen(true);
  };

  if (selectedId && selectedName) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group flex items-center gap-2 px-3 py-1.5 rounded-lg",
          "bg-muted/60 hover:bg-muted border border-border/50 hover:border-border",
          "transition-colors text-left max-w-full",
        )}
      >
        <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <span className="text-xs font-semibold text-primary">
            {selectedName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium truncate block">{selectedName}</span>
          {selectedCompany && (
            <span className="text-xs text-muted-foreground truncate block">
              {selectedCompany}
            </span>
          )}
        </div>
        <X
          className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            handleClear();
          }}
        />
      </button>
    );
  }

  /*
   * `modal`: os dois únicos usos deste seletor são dentro de diálogo —
   * `NewOrderModal.tsx:275` e `EditOrderDialog.tsx:254`, ambos dentro do próprio
   * `DialogContent`. O `react-remove-scroll` do Dialog engole o `wheel` de tudo
   * que sai por portal, e a lista aqui é a carteira INTEIRA de clientes ativos
   * (`CommandList`, `max-h-[300px] overflow-y-auto` em `ui/command.tsx:63`).
   *
   * É o mesmo conserto que o `ProductCombobox.tsx:155` — que fica ao lado dele,
   * no mesmo `DialogContent` — já tinha desde a #1862. Este ficou para trás.
   */
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex items-center gap-2 w-full px-3 py-2 rounded-lg",
            "bg-muted/40 border border-border/50 hover:border-border",
            "text-sm text-muted-foreground transition-colors",
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          Buscar cliente...
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Nome ou empresa..." />
          <CommandList>
            <CommandEmpty>Nenhum cliente encontrado</CommandEmpty>
            <CommandGroup>
              {activeClients.map((c) => (
                <CommandItem
                  key={c.id}
                  // O código do ERP entra no `value` porque é ele que o cmdk
                  // filtra: sem isso, digitar "1234" não acharia o cliente que a
                  // lista logo abaixo mostra como "1234 - …".
                  value={`${c.external_id ?? ""} ${c.name} ${c.company ?? ""}`}
                  onSelect={() => handleSelect(c.id)}
                  className="flex items-center gap-2 py-2"
                >
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-xs font-medium text-muted-foreground">
                      {c.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm truncate">{erpLabel(c)}</div>
                    {c.company && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {c.company}
                      </div>
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
