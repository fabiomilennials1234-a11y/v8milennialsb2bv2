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
import { DonoDaLinha } from "./DonoDaLinha";

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
                  {/* Só o admin: para o vendedor a agenda inteira já é dele. */}
                  {isAdmin && (
                    <DonoDaLinha
                      nome={e.owner_name}
                      className="mt-0.5"
                      semDonoLabel="Sem responsável"
                    />
                  )}
                </span>

                <span className="hidden shrink-0 items-center gap-1.5 text-muted-foreground/50 sm:flex">
                  {e.meet_link && <Video className="h-3 w-3" />}
                  {e.location && <MapPin className="h-3 w-3" />}
                </span>

                {/* Contagem regressiva à direita: a coluna da esquerda diz QUANDO
                    é, esta diz QUANTO FALTA. São leituras diferentes — "qui, 11
                    set" não responde "isso é longe?" sem uma conta de cabeça. */}
                {(() => {
                  const { texto, hoje } = diasAte(inicioEvento, inicio);
                  return (
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                        hoje
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground/70",
                      )}
                    >
                      {texto}
                    </span>
                  );
                })()}
              </button>
            </li>
          );
        })}
      </ul>
    </ComandoCard>
  );
}
