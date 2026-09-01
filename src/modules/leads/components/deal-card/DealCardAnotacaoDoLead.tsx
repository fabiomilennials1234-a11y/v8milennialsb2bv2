import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A anotação da PESSOA, dentro do painel do Negócio.
 *
 * ── POR QUE ELA PRECISA EXISTIR AQUI ──────────────────────────────────────
 * `leads.notes` é o campo de texto mais preenchido do produto: **29.190 leads
 * (74,9%)**, contra 379 em `pipeline_entries.notes` e 3.094 comentários vivos.
 * Ele mora na coluna da esquerda do painel (`LeadCardAside` → `LeadCardNotes`)
 * — e abaixo de 768px essa coluna **não é montada**: `DealCardPanel` chama
 * `conteudo(false)` e o negócio ocupa a tela inteira. No celular, portanto, o
 * texto que a equipe mais escreve simplesmente não existe em lugar nenhum do
 * Negócio.
 *
 * É a mesma ausência que o slot `etiquetas` já conserta, e o remédio é o mesmo:
 * o painel decide se a coluna existe e pendura isto quando ela não existe.
 *
 * ── AS DUAS REGRAS DE INTERAÇÃO ───────────────────────────────────────────
 * 1. **Grava no `blur`, não a cada tecla.** É o mesmo comportamento da anotação
 *    do negócio logo acima e da coluna da esquerda; divergir aqui faria a mesma
 *    caixa salvar de dois jeitos dependendo do tamanho da tela.
 * 2. **Só grava se MUDOU.** `leads.notes` é campo único, sem histórico: um
 *    `update` à toa a cada foco perdido gastaria escrita e sujaria o
 *    `lead_history` com `field_updated` que não mudou nada.
 *
 * 🚨 O componente é PURO de propósito. `DealCard.tsx` está no grafo de
 * `/preview.html` e `preview-cards-sem-banco.test.ts` reprova a palavra
 * `supabase` como TEXTO em qualquer arquivo alcançável dali — inclusive no
 * caminho de um import. Quem grava é o `DealCardPanel`; aqui chega um valor e
 * um callback.
 */
export function DealCardAnotacaoDoLead({
  nome,
  valor,
  onSalvar,
}: {
  /** Primeiro nome da pessoa, para o rótulo dizer de QUEM é a anotação. */
  nome?: string | null;
  valor: string;
  /** Ausente deixa a caixa só de leitura — sem org conhecida o update falharia. */
  onSalvar?: (texto: string) => void;
}) {
  const [texto, setTexto] = useState(valor);

  // Quando a query volta com outro valor (outro lead, ou a mesma nota gravada
  // noutra aba), a caixa acompanha — menos enquanto a pessoa digita, que é o
  // que `valor` já garante ao só mudar depois do salvamento.
  useEffect(() => {
    setTexto(valor);
  }, [valor]);

  const rotulo = nome?.trim() ? `Anotação de ${nome.trim().split(/\s+/)[0]}` : "Anotação da pessoa";

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex items-baseline gap-2">
        <UserRound className="size-3.5 shrink-0 self-center text-muted-foreground/60" aria-hidden="true" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
          {rotulo}
        </h3>
        {/* A frase que impede a troca de caixa. A de cima é deste negócio;
            esta vale para todos os negócios da pessoa, e sobrescrever aqui
            apaga para todos eles. */}
        <span className="text-[10.5px] text-muted-foreground/60">
          vale para todos os negócios dela
        </span>
      </div>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => texto !== valor && onSalvar?.(texto)}
        readOnly={!onSalvar}
        aria-label={rotulo}
        placeholder="O que precisa ser lembrado sobre esta pessoa…"
        rows={4}
        className={cn(
          "w-full resize-none rounded-lg border border-border bg-card px-3.5 py-2.5",
          "text-[13px] leading-relaxed placeholder:text-muted-foreground/70",
          "transition-colors hover:border-muted-foreground/30",
          "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
          !onSalvar && "cursor-default opacity-80 hover:border-border",
        )}
      />
    </section>
  );
}
