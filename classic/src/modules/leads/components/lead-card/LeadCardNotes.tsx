import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Nota do lead — sempre visível, sempre editável, sem clique de entrada.
 *
 * Por que ganha lugar fixo em vez de aba: `leads.notes` está preenchido em
 * **74,9% dos leads vivos** (26.398 de 35.222), o campo mais escrito do produto
 * depois de nome, origem e telefone. `lead_comments`, que tem autor, data e
 * menção, aparece em 4,4% — dezessete vezes menos. A diferença mais provável
 * não é preferência por texto solto: é que a nota está na cara e o comentário
 * está atrás de uma aba.
 *
 * Salvamento por perda de foco, não por botão. Botão de salvar em campo de
 * anotação é a forma mais barata de perder anotação.
 */
export function LeadCardNotes({
  valor,
  onSave,
}: {
  valor: string;
  onSave?: (texto: string) => void;
}) {
  const [texto, setTexto] = useState(valor);
  const [salvo, setSalvo] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Cresce com o conteúdo até um teto, e só então rola por dentro. Sem teto,
  // uma anotação longa empurraria as métricas e os negócios para fora do
  // trilho; sem crescer nenhum, esconderia o que a pessoa acabou de escrever.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // Teto em múltiplo exato da entrelinha (6 linhas × 22px + 24px de padding).
    // Fora do múltiplo, a última linha aparece cortada ao meio e a nota passa a
    // parecer quebrada em vez de rolável.
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 84), 156)}px`;
  }, [texto]);

  useEffect(() => setTexto(valor), [valor]);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
          Anotações
        </h2>
        <span
          className={cn(
            "text-[11px] text-muted-foreground transition-opacity duration-500",
            salvo ? "opacity-100" : "opacity-0",
          )}
          aria-live="polite"
        >
          salvo
        </span>
      </div>

      <textarea
        ref={ref}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setSalvo(false);
        }}
        onBlur={() => {
          if (texto !== valor) {
            onSave?.(texto);
            setSalvo(true);
          }
        }}
        placeholder="O que você precisa lembrar sobre esta pessoa…"
        className={cn(
          "w-full resize-none rounded-lg border border-border bg-card px-3.5 py-3",
          "text-[13.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/70",
          "transition-colors hover:border-muted-foreground/30",
          "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
        )}
      />
    </section>
  );
}
