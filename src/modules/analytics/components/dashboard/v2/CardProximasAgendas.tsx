import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, MapPin, Video } from "lucide-react";
import { useAgendaEvents, type AgendaEvent } from "@/modules/engagement";
import { ComandoCard } from "./ComandoCard";

const MOSTRAR = 6;
/** Janela de "próximas". Curta o bastante para ser fila, longa para não vazar. */
const DIAS_A_FRENTE = 14;

/**
 * Estados terminais que NÃO são compromisso futuro.
 *
 * 🔴 `get_agenda_events` NÃO filtra `status` em nenhuma das duas fontes de
 * reunião — li o corpo da função: a Source 1 (`meetings`) filtra só org +
 * janela, e a Source 4 (`pipe_confirmacao`) filtra só `meeting_date IS NOT NULL`
 * + janela. Sem este recorte no cliente, o vendedor veria reunião cancelada e
 * confirmação já perdida na fila do dia.
 *
 * O conjunto une o que as duas telas que já resolvem isso usam: `AlertsDropdown`
 * (`compareceu`, `perdido`) e `agenda-helpers.normalizeGoogleEvents`
 * (`cancelled`).
 */
const STATUS_ENCERRADO = new Set([
  "cancelled",
  "canceled",
  "cancelado",
  "compareceu",
  "perdido",
  "completed",
  "concluido",
]);

function rotuloDoDia(inicio: Date): string {
  if (isToday(inicio)) return "Hoje";
  if (isTomorrow(inicio)) return "Amanhã";
  return format(inicio, "EEE, dd MMM", { locale: ptBR });
}

/**
 * Bloco 2 — o que já está marcado.
 *
 * Reusa `useAgendaEvents`, que é a MESMA fonte da tela /agenda (RPC
 * `get_agenda_events`, UNION de meetings + follow_ups + scheduled_user_messages
 * + pipe_confirmacao). Não existe segunda consulta aqui: se a agenda mudar de
 * fonte, este bloco acompanha sozinho.
 */
export function CardProximasAgendas() {
  const navigate = useNavigate();

  // A janela é derivada uma vez; recriar `new Date()` a cada render trocaria a
  // queryKey em todo ciclo e a query nunca sairia de `fetching`.
  const [inicio, fim] = useMemo(() => {
    const agora = new Date();
    const limite = new Date(agora);
    limite.setDate(limite.getDate() + DIAS_A_FRENTE);
    return [agora, limite];
  }, []);

  const { data, isLoading, isError, refetch } = useAgendaEvents(inicio, fim);

  const eventos = useMemo(() => {
    const agora = inicio.getTime();
    return (data ?? [])
      .filter((e: AgendaEvent) => !STATUS_ENCERRADO.has((e.status ?? "").toLowerCase()))
      // A janela da RPC é assimétrica por fonte: `meetings` usa OVERLAP, então
      // devolve reunião que começou antes de agora e ainda não acabou. Numa
      // lista de "próximas" isso confunde — o corte é explícito aqui.
      .filter((e: AgendaEvent) => new Date(e.start_at).getTime() >= agora)
      .sort(
        (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
      );
  }, [data, inicio]);

  const visiveis = eventos.slice(0, MOSTRAR);
  const restantes = eventos.length - visiveis.length;

  return (
    <ComandoCard
      icon={CalendarClock}
      title="Próximas agendas"
      count={eventos.length}
      action={{ label: "Ver agenda", to: "/agenda" }}
      isLoading={isLoading}
      isError={isError}
      isEmpty={visiveis.length === 0}
      emptyTitle="Nada marcado"
      emptyHint={`Sem compromisso nos próximos ${DIAS_A_FRENTE} dias. Marque pela agenda ou movendo um lead para a etapa de reunião.`}
      onRetry={() => void refetch()}
      footer={
        restantes > 0 ? (
          <p className="text-[11px] text-muted-foreground/70">
            e mais <span className="font-bold tabular-nums">{restantes}</span> na
            janela de {DIAS_A_FRENTE} dias
          </p>
        ) : null
      }
    >
      <ul className="divide-y divide-border/50">
        {visiveis.map((e) => {
          const inicioEvento = new Date(e.start_at);
          return (
            <li key={`${e.source}:${e.id}`}>
              <button
                type="button"
                onClick={() => navigate("/agenda")}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
              >
                {/* Data e hora ocupam coluna fixa: a lista fica lida na vertical. */}
                <span className="flex w-[62px] shrink-0 flex-col">
                  <span className="text-[11px] font-bold capitalize leading-tight">
                    {rotuloDoDia(inicioEvento)}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground/70">
                    {e.all_day ? "dia todo" : format(inicioEvento, "HH:mm")}
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">
                    {e.title?.trim() || e.lead_name || "Compromisso"}
                  </span>
                  {/* A descrição escrita por quem criou o compromisso. */}
                  {e.description?.trim() ? (
                    <span className="block truncate text-[11px] text-muted-foreground/70">
                      {e.description}
                    </span>
                  ) : e.lead_name ? (
                    <span className="block truncate text-[11px] text-muted-foreground/70">
                      {e.lead_name}
                      {e.lead_company ? ` · ${e.lead_company}` : ""}
                    </span>
                  ) : null}
                </span>

                <span className="hidden shrink-0 items-center gap-1.5 text-muted-foreground/50 sm:flex">
                  {e.meet_link && <Video className="h-3 w-3" />}
                  {e.location && <MapPin className="h-3 w-3" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </ComandoCard>
  );
}
