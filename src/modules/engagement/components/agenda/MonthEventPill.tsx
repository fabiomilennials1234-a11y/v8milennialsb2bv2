/**
 * Compact event pill rendered inside month grid cells.
 */

import { format } from "date-fns";
import { Check, X } from "lucide-react";
import type { UnifiedEvent } from "./agenda-helpers";
import { initialsOf, isFinishedEvent, outcomeOf } from "./agenda-helpers";

interface MonthEventPillProps {
  event: UnifiedEvent;
  onClick: (e: React.MouseEvent, event: UnifiedEvent) => void;
  /**
   * Quem vê a agenda inteira precisa saber de quem é cada compromisso sem
   * abrir um por um — as iniciais do responsável entram à direita da pílula.
   * Para o usuário comum a informação é redundante (é sempre ele).
   */
  showOwner?: boolean;
}

export function MonthEventPill({
  event,
  onClick,
  showOwner = false,
}: MonthEventPillProps) {
  const color = event.color;
  const hora = event.allDay ? "dia todo" : format(event.start, "HH:mm");
  const owner = showOwner ? initialsOf(event.creatorName) : "";
  const done = isFinishedEvent(event);
  const resultado = outcomeOf(event);

  return (
    <button
      className="flex w-full items-center gap-1 rounded border-l-2 px-1.5 py-px text-left text-[10px] leading-snug text-foreground transition-all hover:brightness-110"
      style={{
        // A cor da fonte fica na borda e no banho de fundo, nunca no texto: o
        // ouro (`meeting`) sobre o creme do tema claro dá ~1,7:1 — o mesmo
        // motivo pelo qual DESIGN.md proíbe ouro como texto. `color-mix`
        // tolera hex e hsl, então as 5 fontes tingem igual.
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e, event);
      }}
      title={[
        `${hora} · ${event.title}`,
        event.creatorName ? `Responsável: ${event.creatorName}` : null,
        resultado === "compareceu"
          ? "Compareceu"
          : resultado === "nao_compareceu"
            ? "Não compareceu"
            : null,
      ]
        .filter(Boolean)
        .join("\n")}
    >
      {/* O resultado precisa ser legível na grade, sem abrir o evento. Ícone
          antes do texto, e não só cor — daltônico e impressão em preto e
          branco continuam funcionando (DESIGN.md § Cor). */}
      {resultado === "compareceu" && (
        <Check
          className="h-2.5 w-2.5 shrink-0 text-emerald-700 dark:text-emerald-300"
          strokeWidth={3}
          aria-label="Compareceu"
        />
      )}
      {resultado === "nao_compareceu" && (
        <X
          className="h-2.5 w-2.5 shrink-0 text-red-700 dark:text-red-300"
          strokeWidth={3}
          aria-label="Não compareceu"
        />
      )}

      {/* Cor sozinha não é sinal (DESIGN.md): finalizado ganha o risco no texto. */}
      <span className={`min-w-0 flex-1 truncate ${done ? "line-through opacity-70" : ""}`}>
        {hora} {event.title}
      </span>
      {owner && (
        // `text-foreground/70`, e não `text-muted-foreground`: as iniciais são
        // o único jeito de o admin saber de quem é o compromisso na grade, e
        // o token secundário mede ~3,6:1 sobre o banho de cor da pílula no
        // tema claro. Aqui elas precisam ser lidas, não sussurradas.
        <span className="shrink-0 font-semibold text-foreground/70">{owner}</span>
      )}
    </button>
  );
}
