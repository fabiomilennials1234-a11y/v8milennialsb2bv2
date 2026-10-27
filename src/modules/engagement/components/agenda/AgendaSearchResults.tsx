/**
 * Resultado da busca global da Agenda.
 *
 * Substitui o calendário enquanto há termo digitado: o resultado não cabe em
 * grade nenhuma, porque a busca NÃO tem janela de datas. Cada linha leva a data
 * por extenso (o Dia só mostra a hora) e o clique manda a Agenda para o dia do
 * compromisso e abre o detalhe.
 *
 * Quatro estados, todos explícitos — "vazio" nunca pode parecer "ainda
 * carregando" nem "deu erro": termo curto demais, carregando, erro, sem
 * resultado.
 */

import { useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, CalendarOff, Check, Loader2, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/bento";
import type { UnifiedEvent } from "./agenda-helpers";
import { isFinishedEvent, outcomeOf } from "./agenda-helpers";
import { eventSubtitle } from "./DayAgendaView";
import { AGENDA_SEARCH_LIMIT, AGENDA_SEARCH_MIN_CHARS } from "../../hooks/useAgendaSearch";

const PANEL_CLASS =
  "rounded-card border border-card-border bg-card shadow-relevo";

interface AgendaSearchResultsProps {
  /** O que está digitado (já aparado). */
  term: string;
  events: UnifiedEvent[];
  isPending: boolean;
  isError: boolean;
  /** A função de busca ainda não existe no banco (migration não aplicada). */
  isUnavailable?: boolean;
  onRetry: () => void;
  onEventClick: (e: React.MouseEvent, event: UnifiedEvent) => void;
  showOwner?: boolean;
  /** Injetável para teste; padrão = agora. */
  now?: Date;
}

function ResultRow({
  event,
  showOwner,
  onEventClick,
}: {
  event: UnifiedEvent;
  showOwner: boolean;
  onEventClick: AgendaSearchResultsProps["onEventClick"];
}) {
  const finished =
    isFinishedEvent(event) && (event.status ?? "").toLowerCase() !== "no_show";
  const desfecho = outcomeOf(event);
  return (
    <li className="flex gap-3">
      <div className="w-24 shrink-0 pt-2 text-[11px] font-semibold tabular-nums text-muted-foreground">
        <div>{format(event.start, "d MMM yyyy", { locale: ptBR })}</div>
        <div>{event.allDay ? "Dia todo" : format(event.start, "HH:mm")}</div>
      </div>
      <button
        type="button"
        onClick={(e) => onEventClick(e, event)}
        className="min-w-0 flex-1 rounded-xl border-l-[3px] py-2 pl-3 pr-2 text-left transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          backgroundColor: `color-mix(in srgb, ${event.color} 14%, transparent)`,
          borderColor: event.color,
        }}
      >
        <div className="flex items-center gap-1.5">
          {desfecho === "compareceu" && (
            <Check
              className="h-3 w-3 shrink-0 text-emerald-700 dark:text-emerald-300"
              strokeWidth={3}
              aria-label="Compareceu"
            />
          )}
          {desfecho === "nao_compareceu" && (
            <X
              className="h-3 w-3 shrink-0 text-red-700 dark:text-red-300"
              strokeWidth={3}
              aria-label="Não compareceu"
            />
          )}
          <div
            className={`min-w-0 truncate text-[13px] font-semibold text-foreground ${finished ? "line-through opacity-70" : ""}`}
          >
            {event.title}
          </div>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {eventSubtitle(event, showOwner)}
        </div>
      </button>
    </li>
  );
}

function Estado({
  icon: Icon,
  titulo,
  detalhe,
  children,
}: {
  icon: typeof CalendarOff;
  titulo: string;
  detalhe?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-foreground">{titulo}</p>
      {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
      {children}
    </div>
  );
}

export function AgendaSearchResults({
  term,
  events,
  isPending,
  isError,
  isUnavailable = false,
  onRetry,
  onEventClick,
  showOwner = false,
  now,
}: AgendaSearchResultsProps) {
  // Futuros primeiro, depois os passados — a ordem já vem do banco; aqui só se
  // parte a lista em dois blocos rotulados.
  const { proximos, anteriores } = useMemo(() => {
    const agora = (now ?? new Date()).getTime();
    return {
      proximos: events.filter((e) => e.start.getTime() >= agora),
      anteriores: events.filter((e) => e.start.getTime() < agora),
    };
  }, [events, now]);

  let corpo: React.ReactNode;

  if (term.length < AGENDA_SEARCH_MIN_CHARS) {
    corpo = (
      <Estado
        icon={CalendarOff}
        titulo="Continue digitando"
        detalhe={`Digite pelo menos ${AGENDA_SEARCH_MIN_CHARS} caracteres para buscar.`}
      />
    );
  } else if (isError) {
    corpo = (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <IconChip icon={AlertTriangle} tone="bad" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {isUnavailable
                ? "A busca ainda não está disponível."
                : "Não foi possível buscar na agenda."}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isUnavailable
                ? "Tente novamente em alguns minutos."
                : "Isto não significa que não haja nada marcado."}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
          <RefreshCw />
          Tentar de novo
        </Button>
      </div>
    );
  } else if (isPending) {
    corpo = (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Buscando “{term}”…
      </div>
    );
  } else if (events.length === 0) {
    corpo = (
      <Estado
        icon={CalendarOff}
        titulo={`Nada marcado para “${term}”`}
        detalhe="A busca olha todas as datas: título, cliente, empresa e código."
      />
    );
  } else {
    const grupo = (rotulo: string, lista: UnifiedEvent[]) =>
      lista.length > 0 && (
        <section aria-label={rotulo} className="space-y-2.5">
          <h3 className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
            {rotulo}
          </h3>
          <ul className="space-y-2.5">
            {lista.map((event) => (
              <ResultRow
                key={event.id}
                event={event}
                showOwner={showOwner}
                onEventClick={onEventClick}
              />
            ))}
          </ul>
        </section>
      );
    corpo = (
      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        {grupo("Próximos", proximos)}
        {grupo("Anteriores", anteriores)}
        {events.length >= AGENDA_SEARCH_LIMIT && (
          <p className="text-center text-xs text-muted-foreground">
            Mostrando os {AGENDA_SEARCH_LIMIT} primeiros. Refine a busca para ver outros.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col p-4 ${PANEL_CLASS}`}
      data-testid="agenda-search-results"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="truncate text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          Busca na agenda · todas as datas
        </div>
        {!isPending && !isError && events.length > 0 && (
          <div className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
            {events.length}{" "}
            {events.length === 1 ? "compromisso" : "compromissos"}
          </div>
        )}
      </div>
      {corpo}
    </div>
  );
}
