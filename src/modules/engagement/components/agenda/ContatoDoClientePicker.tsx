import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPhoneBR } from "@/shared/format/phone";
import type { ContatoDoCliente } from "@/shared/format/cliente-agenda";

interface ContatoDoClientePickerProps {
  contatos: ContatoDoCliente[];
  /** `lead_phones.id` escolhido; `""` = nenhum. */
  value: string;
  onChange: (id: string) => void;
}

/** "Ana - Financeiro" → "AF"; o que vem depois do hífen é setor, não sobrenome. */
function iniciais(nome: string): string {
  const palavras = nome.replace(/[^\p{L}\s-]/gu, " ").split(/[\s-]+/).filter(Boolean);
  return palavras.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("");
}

/**
 * Com quem é a agenda, quando o cliente tem mais de um contato (Café: o ERP
 * manda "Carlos - Compras", "Ana - Financeiro"...). Cada opção é uma linha de
 * `lead_phones` — nome e número —, no mesmo desenho das linhas da busca de
 * cliente logo acima. O escolhido troca as iniciais pelo ✓ no próprio selo (o
 * espaço de um ✓ à direita cortava o número). Radix cuida das setas do
 * teclado e do `aria-checked`.
 */
export function ContatoDoClientePicker({ contatos, value, onChange }: ContatoDoClientePickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id="agendamento-contato" className="text-[12px] font-semibold">Contato</span>
        <span className="text-[11.5px] text-muted-foreground">{contatos.length} contatos neste cliente</span>
      </div>
      <RadioGroupPrimitive.Root
        aria-labelledby="agendamento-contato"
        value={value}
        onValueChange={onChange}
        className="scrollbar-rail grid max-h-[188px] gap-2 overflow-y-auto p-px sm:grid-cols-2"
      >
        {contatos.map((c) => {
          const ativo = c.id === value;
          return (
            <RadioGroupPrimitive.Item
              key={c.id}
              value={c.id}
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ativo ? "border-primary/60 bg-primary-soft/60" : "border-border hover:bg-muted/50",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-md text-[12px] font-semibold transition-colors",
                  ativo ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                )}
              >
                {ativo ? (
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                ) : c.nome && iniciais(c.nome) ? (
                  iniciais(c.nome)
                ) : (
                  <Phone className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span title={c.nome ?? undefined} className={cn("block truncate text-[13px] font-semibold", !c.nome && "font-normal text-muted-foreground")}>
                  {c.nome ?? "Sem nome"}
                </span>
                <span className="block truncate text-[11.5px] tabular-nums text-muted-foreground">
                  {formatPhoneBR(c.telefone)}
                  {c.principal && <> · Principal</>}
                </span>
              </span>
            </RadioGroupPrimitive.Item>
          );
        })}
      </RadioGroupPrimitive.Root>
    </div>
  );
}
