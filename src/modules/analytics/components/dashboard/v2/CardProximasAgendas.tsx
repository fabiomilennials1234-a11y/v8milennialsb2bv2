import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, MapPin, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { diasAte } from "@/modules/analytics/lib/comando-proximos-passos";
import {
  useComandoAgenda,
  type ComandoAgendaEvent,
} from "@/modules/analytics/hooks/useComandoAgenda";
import { ComandoCard } from "./ComandoCard";

/** Os próximos cinco compromissos — pedido do CTO em 2026-09-04. */
const MOSTRAR = 5;
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
 * Lê `useComandoAgenda`, que COMPÕE sobre a mesma `get_agenda_events` da tela
 * /agenda (UNION de meetings + follow_ups + scheduled_user_messages +
 * pipe_confirmacao + meeting_events) e só acrescenta o recorte por usuário.
 * Se a agenda ganhar uma sexta fonte, este bloco acompanha sozinho.
 *
 * ⚠️ NÃO usa `useAgendaEvents` direto de propósito: aquele hook serve a tela
 * /agenda, que deve continuar mostrando a operação inteira. Aqui o vendedor vê
 * só os compromissos dele (mais os que não são de ninguém — 61% das reuniões
 * de confirmação estão nesse caso, medido no PROD). Quem recorta é a RPC.
 */
export function CardProximasAgendas() {
  const navigate = useNavigate();

  // A janela é derivada uma vez POR DIA. Recriar `new Date()` a cada render
  // trocaria a queryKey em todo ciclo e a query nunca sairia de `fetching`;
  // memoizar com `[]`, como estava, congelava a janela no momento em que a aba
  // foi aberta — quem deixa o Comando aberto durante a virada do dia
  // continuava lendo "Hoje" sobre ontem, e nem refetch corrigia, porque os ISO
  // congelados também iam na chave.
  const diaCorrente = new Date().toDateString();
  const [inicio, fim] = useMemo(() => {
    const agora = new Date();
    const limite = new Date(agora);
    limite.setDate(limite.getDate() + DIAS_A_FRENTE);
    return [agora, limite];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a data é a dependência real; `diaCorrente` é a forma estável dela
  }, [diaCorrente]);

  const { data, isLoading, isError, isAdmin, refetch } = useComandoAgenda(
    inicio,
    fim,
  );

  const eventos = useMemo(() => {
    const agora = inicio.getTime();
    return (data ?? [])
      .filter((e: ComandoAgendaEvent) => !STATUS_ENCERRADO.has((e.status ?? "").toLowerCase()))
      // A janela da RPC é assimétrica por fonte: `meetings` usa OVERLAP, então
      // devolve reunião que começou antes de agora e ainda não acabou. Numa
      // lista de "próximas" isso confunde — o corte é explícito aqui.
      .filter((e: ComandoAgendaEvent) => new Date(e.start_at).getTime() >= agora)
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
      scopeHint={isAdmin ? "Equipe" : undefined}
      action={{ label: "Ver agenda", to: "/agenda" }}
      isLoading={isLoading}
      isError={isError}
      isEmpty={visiveis.length === 0}
      emptyTitle="Nada marcado"
      emptyHint={
        isAdmin
          ? `Sem compromisso do time nos próximos ${DIAS_A_FRENTE} dias. Marque pela agenda ou movendo um lead para a etapa de reunião.`
          : `Você não tem compromisso nos próximos ${DIAS_A_FRENTE} dias. Marque pela agenda ou movendo um lead para a etapa de reunião.`
      }
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
      {/* V5: linha do tempo. O nó de ouro é o PRÓXIMO compromisso; os demais
          ficam em anel. O dia só aparece quando não é hoje — a hora é a leitura
          principal, em coluna fixa e monoespaçada. */}
      <ul className="relative px-4 py-2">
        <span aria-hidden className="absolute bottom-6 left-[23px] top-6 w-px bg-border" />
        {visiveis.map((e, i) => {
          const inicioEvento = new Date(e.start_at);
          const { hoje } = diasAte(inicioEvento, inicio);
          const proximo = i === 0;
          return (
            <li key={`${e.source}:${e.id}`} className="relative">
              <button
                type="button"
                onClick={() => navigate("/agenda")}
                className="flex w-full items-start gap-3 rounded-2xl py-2 pr-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  className={cn(
                    "relative z-[1] mt-[3px] h-[13px] w-[13px] shrink-0 rounded-full",
                    proximo ? "bg-primary shadow-brilho-ouro" : "border-2 border-border bg-card",
                  )}
                />
                <span className="flex w-[52px] shrink-0 flex-col">
                  {!hoje && (
                    <span className="text-[10.5px] font-bold capitalize leading-tight text-muted-foreground">
                      {rotuloDoDia(inicioEvento)}
                    </span>
                  )}
                  <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                    {e.all_day ? "dia todo" : format(inicioEvento, "HH:mm")}
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">
                    {e.title?.trim() || e.lead_name || "Compromisso"}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {[
                      e.lead_name ? `${e.lead_name}${e.lead_company ? ` · ${e.lead_company}` : ""}` : e.description?.trim(),
                      // Só o admin: para o vendedor a agenda inteira já é dele.
                      isAdmin ? (e.owner_name ? `com ${e.owner_name.split(" ")[0]}` : "sem responsável") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>

                <span className="mt-0.5 hidden shrink-0 items-center gap-1.5 text-muted-foreground/60 sm:flex">
                  {e.meet_link && <Video className="h-3.5 w-3.5" aria-label="Com link de reunião" />}
                  {e.location && <MapPin className="h-3.5 w-3.5" aria-label="Presencial" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </ComandoCard>
  );
}
