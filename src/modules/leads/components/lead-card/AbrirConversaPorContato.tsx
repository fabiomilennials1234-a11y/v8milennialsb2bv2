import { useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ContatoDaConversa } from "./types";

/**
 * "Abrir conversa com qual contato?" — Chamado b7941f5e.
 *
 * Lead com 2+ telefones e nenhum escolhido no negócio: o botão pergunta em vez
 * de cair no principal. É a regra de `telefoneDoNegocio.ts` (CTO, 07/10) —
 * nunca chutar o principal — levada aos lugares onde a faixa "Com quem é este
 * negócio" não existe: card de funil sem negócio e ficha da lista de leads.
 *
 * Recebe o botão pronto (`children`) para o cabeçalho continuar com um só
 * desenho de "Abrir conversa", com ou sem pergunta. Sem banco: fica no grafo do
 * `/preview.html` (`preview-cards-sem-banco.test.ts`).
 */
export function AbrirConversaPorContato({
  contatos,
  abrir,
  children,
}: {
  contatos: ReadonlyArray<ContatoDaConversa>;
  abrir: (telefone: string) => void;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] overflow-hidden rounded-xl p-0">
        <div className="px-3 pb-2 pt-3">
          <p className="text-[13px] font-semibold text-foreground">Abrir conversa com qual contato?</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            Este lead tem {contatos.length} contatos. A conversa abre no número escolhido.
          </p>
        </div>
        <ul className="border-t border-border py-1">
          {contatos.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  setAberto(false);
                  abrir(c.telefone);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left",
                  "transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                  c.whatsApp === false && "opacity-70",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[13px]",
                      c.nome ? "font-bold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {c.nome ?? "Sem nome"}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[12px] tabular-nums text-foreground/85">
                    {c.numero}
                    {c.principal && (
                      <span className="rounded-full bg-muted px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">
                        Principal
                      </span>
                    )}
                  </span>
                </span>
                {/* Atenuado, não desabilitado: o dado de WhatsApp vem do ERP e
                    pode estar velho — quem decide é o vendedor. */}
                {c.whatsApp === false && (
                  <span className="shrink-0 text-[10.5px] text-muted-foreground">Sem WhatsApp</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
