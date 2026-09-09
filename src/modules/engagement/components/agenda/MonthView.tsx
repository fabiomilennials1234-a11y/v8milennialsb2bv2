/**
 * Grade mensal — o calendário que ocupa a área principal da Agenda.
 *
 * Sete colunas com o nome do dia por extenso (curto no celular) e, dentro de
 * cada célula, os compromissos daquele dia. A grade rola dentro de si mesma:
 * a página nunca rola de lado (DESIGN.md § Espaço e densidade).
 */

import { format, isToday, isSameDay } from "date-fns";
import type { UnifiedEvent } from "./agenda-helpers";
import { DAY_NAMES_FULL, DAY_NAMES_SHORT, getMonthGrid } from "./agenda-helpers";
import { MonthEventPill } from "./MonthEventPill";

interface MonthViewProps {
  date: Date;
  events: UnifiedEvent[];
  onEventClick: (e: React.MouseEvent, event: UnifiedEvent) => void;
  onSlotClick: (day: Date) => void;
  /** Revelar os compromissos que não couberam na célula ("+N mais"). */
  onShowMore?: (day: Date) => void;
  /** Mostra as iniciais do responsável em cada compromisso (visão de admin). */
  showOwner?: boolean;
}

/** Quantas pílulas cabem numa célula antes do "+N mais". */
const MAX_PILLS = 3;

export function MonthView({
  date,
  events,
  onEventClick,
  onSlotClick,
  onShowMore,
  showOwner = false,
}: MonthViewProps) {
  const days = getMonthGrid(date);
  const currentMonth = date.getMonth();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Um único contêiner de rolagem para cabeçalho e grade: separados, eles
          desalinhariam no celular, onde 7 colunas não cabem na largura e a
          grade precisa rolar de lado DENTRO do cartão — a página nunca rola de
          lado (DESIGN.md § Espaço e densidade). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="grid min-w-[680px] shrink-0 grid-cols-7 border-b border-border md:min-w-0">
          {DAY_NAMES_FULL.map((name, i) => (
            <div
              key={name}
              className="truncate px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground"
            >
              <span className="hidden lg:inline">{name}</span>
              <span className="lg:hidden">{DAY_NAMES_SHORT[i]}</span>
            </div>
          ))}
        </div>

        {/* Grade. `auto-rows-[minmax(108px,1fr)]`, e NÃO `grid-rows-6`: com seis
            trilhas de `1fr` numa altura definida, cada trilha vale 1/6 exato —
            numa tela de 768px isso dá menos que a altura de uma célula com
            compromissos, e as linhas se sobrepõem. O `minmax` põe piso e deixa
            crescer; o contêiner rola quando não couber.

            108px é o piso MEDIDO no navegador para a célula cheia: 12 de
            padding + 20 do número + 4 de respiro + três pílulas (49,25) + 4 +
            a linha do "+N mais" (15) = 104,25. Abaixo disso a última pílula
            renderiza cortada ao meio — melhor a grade rolar dentro do cartão
            do que mostrar meia linha. */}
        <div className="grid min-h-0 min-w-[680px] flex-1 auto-rows-[minmax(108px,1fr)] grid-cols-7 md:min-w-0">
          {days.map((day) => {
            const isCurrentMonth = day.getMonth() === currentMonth;
            const today = isToday(day);
            const dayEvents = events.filter((e) => isSameDay(e.start, day));

            // A célula não é <button>: as pílulas dentro dela são, e botão
            // aninhado em botão é HTML inválido. Criar pelo teclado tem caminho
            // próprio — o botão "Nova atividade" no cabeçalho.
            return (
              <div
                key={day.toISOString()}
                onClick={() => onSlotClick(day)}
                className="flex min-h-0 cursor-pointer flex-col items-stretch gap-1 overflow-hidden border-b border-r border-border p-1.5 text-left transition-colors hover:bg-muted/50"
              >
                {/* Hoje é pastilha cheia, não texto dourado: ouro como texto dá
                    ~1,7:1 sobre o creme do tema claro (DESIGN.md § Cor). */}
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums ${
                    today
                      ? "bg-primary font-bold text-primary-foreground"
                      : isCurrentMonth
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  {format(day, "d")}
                </span>

                {/* As pílulas cortam; o "+N mais" NÃO. Numa tela de 768px a
                    linha do mês encolhe e era justamente o aviso de que havia
                    mais coisa que sumia primeiro. */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-px overflow-hidden">
                  {dayEvents.slice(0, MAX_PILLS).map((event) => (
                    <MonthEventPill
                      key={event.id}
                      event={event}
                      onClick={onEventClick}
                      showOwner={showOwner}
                    />
                  ))}
                </div>
                {/* Botão, não texto: antes o "+N mais" era um parágrafo dentro
                    da célula, então clicar nele abria o diálogo de CRIAR — o
                    oposto de "quero ver os que ficaram de fora". */}
                {dayEvents.length > MAX_PILLS && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onShowMore?.(day);
                    }}
                    className="shrink-0 rounded px-1 text-left text-[10px] text-foreground/70 underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  >
                    +{dayEvents.length - MAX_PILLS} mais
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
