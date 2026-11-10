import { useMemo } from "react";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEscopoAgenda } from "@/modules/analytics/hooks/useEscopoAgenda";
import { useResumoAgendaContatos } from "@/modules/analytics/hooks/useAgendaContatos";
import {
  TOM_SITUACAO,
  contarPorSituacao,
  diaLocal,
  proximosDias,
  type FiltroAgenda,
  type ResumoAgendaLinha,
  type SituacaoAgenda,
} from "@/modules/analytics/lib/agenda-contatos";
import { ComandoCard } from "../ComandoCard";

interface CardResumoAgendaProps {
  hoje: string;
  filtro: FiltroAgenda;
  onFiltro: (f: FiltroAgenda) => void;
}

const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const ORDEM: Array<{ situacao: SituacaoAgenda; rotulo: string }> = [
  { situacao: "atrasada", rotulo: "Atrasadas" },
  { situacao: "hoje", rotulo: "Hoje" },
  { situacao: "futura", rotulo: "Futuras" },
];

/**
 * "Próximas agendas" reformulada para a agenda de contatos: quanto há em cada
 * cor e como a semana se distribui. Não repete a tabela — é o mapa dela.
 * Clicar numa cor ou num dia filtra a tabela ao lado.
 */
export function CardResumoAgenda({ hoje, filtro, onFiltro }: CardResumoAgendaProps) {
  const { vendoEquipe } = useEscopoAgenda();
  const { data, isLoading, isError, refetch } = useResumoAgendaContatos();
  return (
    <ResumoAgendaView
      linhas={data ?? []}
      hoje={hoje}
      isAdmin={vendoEquipe}
      filtro={filtro}
      onFiltro={onFiltro}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
    />
  );
}

export interface ResumoAgendaViewProps extends CardResumoAgendaProps {
  linhas: ResumoAgendaLinha[];
  isAdmin: boolean;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/** A parte visual, sem busca de dado. */
export function ResumoAgendaView({ linhas, hoje, isAdmin, filtro, onFiltro, isLoading = false, isError = false, onRetry }: ResumoAgendaViewProps) {
  const cont = useMemo(() => contarPorSituacao(linhas), [linhas]);
  const semana = useMemo(() => proximosDias(linhas, hoje, 7), [linhas, hoje]);
  const maior = Math.max(1, ...semana.map((d) => d.total));
  const total = cont.atrasada + cont.hoje + cont.futura;

  return (
    <ComandoCard
      icon={CalendarRange}
      title="Próximas agendas"
      count={total}
      scopeHint={isAdmin ? "Equipe" : undefined}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      isEmpty={total === 0}
      emptyTitle="Nenhuma agenda"
      emptyHint="Quando houver próximo contato marcado, a semana aparece aqui."
    >
      <div className="flex flex-col gap-4 px-5 pb-5">
        <div className="grid grid-cols-3 gap-2">
          {ORDEM.map(({ situacao, rotulo }) => {
            const ativo = filtro === situacao;
            const n = cont[situacao];
            return (
              <button
                key={situacao}
                type="button"
                aria-pressed={ativo}
                onClick={() => onFiltro(ativo ? "todas" : situacao)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  TOM_SITUACAO[situacao].pill,
                  ativo && "shadow-relevo ring-2",
                  n === 0 && "opacity-60",
                )}
              >
                <span className="text-[22px] font-bold leading-none tabular-nums">{n}</span>
                <span className="text-[11px] font-semibold">{rotulo}</span>
              </button>
            );
          })}
        </div>

        <div>
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Próximos 7 dias</p>
          <ul className="flex items-end gap-1.5">
            {semana.map(({ dia, total: n }, i) => {
              const ativo = filtro === `dia:${dia}`;
              const situacao: SituacaoAgenda = i === 0 ? "hoje" : "futura";
              return (
                <li key={dia} className="flex-1">
                  <button
                    type="button"
                    aria-pressed={ativo}
                    aria-label={`${i === 0 ? "Hoje" : DIA_CURTO[diaLocal(dia).getDay()]}: ${n} ${n === 1 ? "agenda" : "agendas"}`}
                    onClick={() => onFiltro(ativo ? "todas" : (`dia:${dia}` as FiltroAgenda))}
                    disabled={n === 0}
                    className="group flex w-full flex-col items-center gap-1 rounded-xl py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                  >
                    <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{n || ""}</span>
                    <span className="flex h-14 w-full items-end overflow-hidden rounded-lg bg-muted/60">
                      <span
                        aria-hidden
                        className={cn(
                          "w-full rounded-lg transition-[height,filter] group-hover:brightness-95",
                          TOM_SITUACAO[situacao].dot,
                          ativo ? "opacity-100" : "opacity-80",
                        )}
                        style={{ height: n ? `${Math.max(12, (n / maior) * 100)}%` : 0 }}
                      />
                    </span>
                    <span className={cn("text-[10.5px] font-semibold capitalize", ativo ? "text-foreground" : "text-muted-foreground")}>
                      {i === 0 ? "hoje" : DIA_CURTO[diaLocal(dia).getDay()]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {cont.atrasada > 0 && (
          <p className="text-[11.5px] text-destructive-strong">
            {cont.atrasada === 1 ? "1 cliente passou" : `${cont.atrasada} clientes passaram`} da data e continua{cont.atrasada === 1 ? "" : "m"} na lista até alguém fechar no X.
          </p>
        )}
      </div>
    </ComandoCard>
  );
}
