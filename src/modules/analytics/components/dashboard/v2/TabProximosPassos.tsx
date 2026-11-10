import { useMemo, useState } from "react";
import { AlarmClock, CalendarCheck, CalendarClock, ListChecks, MessageSquareDot } from "lucide-react";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import { useComandoTasks } from "@/modules/analytics/hooks/useComandoTasks";
import { useComandoScope } from "@/modules/analytics/hooks/useComandoScope";
import { useConversasAguardando } from "@/modules/analytics/hooks/useConversasAguardando";
import { useComandoAgenda } from "@/modules/analytics/hooks/useComandoAgenda";
import { CardConversasAguardando } from "./CardConversasAguardando";
import { esperaCurta } from "@/modules/analytics/lib/espera-curta";
import { CardProximasAgendas } from "./CardProximasAgendas";
import { CardTarefasDoDia } from "./CardTarefasDoDia";
import { CardMetas } from "./CardMetas";
import { CardAgendaContatos } from "./agenda/CardAgendaContatos";
import { CardResumoAgenda } from "./agenda/CardResumoAgenda";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeatureFlag } from "@/modules/platform";
import { useOrganization } from "@/modules/identity";
import { useResumoAgendaContatos } from "@/modules/analytics/hooks/useAgendaContatos";
import { EscopoAgendaProvider, useEstadoEscopoAgenda } from "@/modules/analytics/hooks/useEscopoAgenda";
import {
  FLAG_AGENDA_CONTATOS,
  contarPorSituacao,
  hojeNoFuso,
  type FiltroAgenda,
} from "@/modules/analytics/lib/agenda-contatos";

/**
 * Comando como CENTRAL DE TRABALHO — a primeira tela do dia.
 *
 * Responde, em ordem de urgência, quatro perguntas:
 *   1. quem falou comigo e não foi respondido?   (dinheiro escapando)
 *   2. o que eu tenho marcado?                   (compromisso assumido)
 *   3. o que eu preciso fazer hoje?              (minha lista)
 *   4. o que já passou do prazo?                 (o vermelho)
 *
 * ─── O QUE ESTA VERSÃO SUBSTITUIU ────────────────────────────────────────────
 * Até aqui esta aba — que é a DEFAULT do produto — era 100% mock: as linhas
 * vinham de `proximos-passos-sample.ts`, um array fixo com "Distribuidora
 * Andrade" e "Metalúrgica Vetri", e o número grande dizia "66 ações esperando
 * você" para TODO usuário que abrisse /dashboard. Os botões de CTA não tinham
 * `onClick`. Havia um selo "Prévia" e um rodapé "Fonte real: …" declarando a
 * intenção.
 *
 * A anatomia visual daquele protótipo foi preservada (faixa de urgência, lista
 * com divisores, contador tabular, densidade). O que mudou é que agora o dado é
 * real — e por isso o selo "Prévia" saiu: mantê-lo sobre dado verdadeiro seria
 * pior do que nunca tê-lo tido.
 *
 * As faixas `propostas-paradas`, `sem-dono` e `esfriando` do protótipo NÃO
 * entraram: dependem de dwell médio por etapa e de "sem interação há N dias",
 * nenhum dos dois com consulta pronta. Ficaram de fora em vez de continuarem
 * fingindo (decisão de 21/08).
 *
 * ─── AGENDA DE CONTATOS (flag `comando_agenda_contatos`, Café Jurerê) ──────
 * Com a flag, "Tarefas" dá lugar à Agenda (o próximo ponto de contato com cada
 * cliente) e "Próximas agendas" vira o mapa dela. Os dois indicadores do meio
 * passam a ser "Agendas de hoje" e "Agendas atrasadas". O hook de tarefas nem
 * monta — ele chama `task_sync_day`, que grava, e não deve rodar para uma tela
 * que não mostra tarefa.
 */
export function TabProximosPassos() {
  const agenda = useFeatureFlag(FLAG_AGENDA_CONTATOS);

  // Até saber a flag, nenhum dos dois layouts monta: montar o clássico por um
  // instante já dispararia o `task_sync_day`.
  if (agenda.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[112px] rounded-card" />)}
        </div>
        <Skeleton className="h-[320px] rounded-card" />
      </div>
    );
  }
  return agenda.enabled ? <ComandoComAgenda /> : <ComandoClassico />;
}

/** "Hoje" no fuso da org — o mesmo dia que o banco usa para pintar as agendas. */
function useHojeDaOrg(): string {
  const { timezone } = useOrganization();
  const diaCorrente = new Date().toDateString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a data é a dependência real
  return useMemo(() => hojeNoFuso(timezone), [timezone, diaCorrente]);
}

function ComandoComAgenda() {
  const hoje = useHojeDaOrg();
  const [filtro, setFiltro] = useState<FiltroAgenda>("todas");
  // Um escopo para a tela inteira: o toggle Meu/Todos do card muda a tabela, o
  // resumo e os dois indicadores de agenda juntos.
  const escopo = useEstadoEscopoAgenda();

  return (
    <EscopoAgendaProvider value={escopo}>
    <div className="flex flex-col gap-4">
      <LinhaDeIndicadoresAgenda onFiltro={setFiltro} />
      {/* A Agenda é o trabalho do dia: logo abaixo dos indicadores, acima das
          conversas (pedido do CTO, 10/11). Largura toda — é uma planilha:
          cliente, empresa, data, dados, contato e o X precisam caber sem
          rolagem lateral. */}
      <CardAgendaContatos hoje={hoje} filtro={filtro} onFiltro={setFiltro} />
      <CardConversasAguardando />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <CardMetas />
        </div>
        <div className="min-w-0">
          <CardResumoAgenda hoje={hoje} filtro={filtro} onFiltro={setFiltro} />
        </div>
      </div>
    </div>
    </EscopoAgendaProvider>
  );
}

function LinhaDeIndicadoresAgenda({ onFiltro }: { onFiltro: (f: FiltroAgenda) => void }) {
  const { isAdmin } = useComandoScope();
  const fila = useConversasAguardando(10);
  const resumo = useResumoAgendaContatos();
  const cont = useMemo(() => contarPorSituacao(resumo.data ?? []), [resumo.data]);
  const reunioes = useReunioesHoje();

  const erro = fila.isError || resumo.isError || fila.chipsComErro > 0;
  const carregando = fila.isLoading || resumo.isLoading;
  const nada = fila.total === 0 && cont.hoje === 0 && cont.atrasada === 0;
  const estado = erro
    ? "Alguns dados não carregaram. Confira os avisos nos cards abaixo."
    : carregando
      ? "Conferindo o dia…"
      : nada
        ? isAdmin ? "Nada esperando o time agora." : "Nada esperando você agora."
        : null;
  const valor = (n: number, e: boolean, l: boolean) => (e ? "—" : l ? "·" : n.toLocaleString("pt-BR"));

  return (
    <>
      {estado && <p className="-mt-1 text-[12px] text-muted-foreground">{estado}</p>}
      <KpiRow cols={4}>
        <TileClientesEsperando fila={fila} isAdmin={isAdmin} />
        <button type="button" onClick={() => onFiltro("hoje")} className="rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <KpiTile
            label="Agendas de hoje"
            value={valor(cont.hoje, resumo.isError, resumo.isLoading)}
            icon={CalendarClock}
            tone={cont.hoje > 0 ? "warn" : "neutral"}
            loading={resumo.isLoading}
            note={cont.hoje > 0 ? "Clientes para contatar hoje" : "Nenhum contato marcado para hoje"}
          />
        </button>
        <button type="button" onClick={() => onFiltro("atrasada")} className="rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <KpiTile
            label="Agendas atrasadas"
            value={valor(cont.atrasada, resumo.isError, resumo.isLoading)}
            icon={AlarmClock}
            tone={cont.atrasada > 0 ? "bad" : "good"}
            loading={resumo.isLoading}
            note={cont.atrasada > 0 ? "Passaram da data, ainda abertas" : "Nenhuma passou da data"}
          />
        </button>
        <TileReunioesHoje reunioes={reunioes} />
      </KpiRow>
    </>
  );
}

function useReunioesHoje() {
  // Janela do dia, derivada uma vez por dia (mesmo cuidado de
  // `CardProximasAgendas` com a queryKey).
  const diaCorrente = new Date().toDateString();
  const [inicioDia, fimDia] = useMemo(() => {
    const i = new Date();
    i.setHours(0, 0, 0, 0);
    const f = new Date(i);
    f.setDate(f.getDate() + 1);
    return [i, f];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a data é a dependência real
  }, [diaCorrente]);
  const agendaHoje = useComandoAgenda(inicioDia, fimDia);
  const contagem = useMemo(() => {
    const doDia = (agendaHoje.data ?? []).filter(
      (e) => e.event_type === "meeting" && !["cancelled", "canceled"].includes((e.status ?? "").toLowerCase()),
    );
    return { total: doDia.length, realizadas: doDia.filter((e) => (e.status ?? "").toLowerCase() === "completed").length };
  }, [agendaHoje.data]);
  return { ...contagem, isLoading: agendaHoje.isLoading, isError: agendaHoje.isError };
}

function TileReunioesHoje({ reunioes }: { reunioes: ReturnType<typeof useReunioesHoje> }) {
  return (
    <KpiTile
      label="Reuniões hoje"
      value={reunioes.isError ? "—" : reunioes.isLoading ? "·" : reunioes.total.toLocaleString("pt-BR")}
      icon={CalendarCheck}
      tone="info"
      loading={reunioes.isLoading}
      note={
        reunioes.total === 0
          ? "Nenhuma marcada para hoje"
          : `${reunioes.realizadas} ${reunioes.realizadas === 1 ? "realizada" : "realizadas"}`
      }
    />
  );
}

function TileClientesEsperando({ fila, isAdmin }: { fila: ReturnType<typeof useConversasAguardando>; isAdmin: boolean }) {
  const { total: aguardando, items: filaItems, isLoading, isError } = fila;
  const maisAntigo = useMemo(() => {
    const vezes = (filaItems ?? []).map((c) => c.lastClientMessageAt).filter(Boolean).sort();
    return vezes[0] ? esperaCurta(vezes[0]) : null;
  }, [filaItems]);
  const avatares = (filaItems ?? []).slice(0, 5);
  const alemDosAvatares = Math.max(0, aguardando - avatares.length);

  return (
    <KpiTile
      label="Clientes esperando"
      value={isError ? "—" : isLoading ? "·" : aguardando.toLocaleString("pt-BR")}
      icon={MessageSquareDot}
      tone={aguardando > 0 ? "gold" : "neutral"}
      loading={isLoading}
      note={maisAntigo ? `mais antigo há ${maisAntigo.texto}` : isAdmin ? "Fila de resposta da equipe" : "Na sua fila de resposta"}
    >
      {avatares.length > 0 && (
        <div className="flex items-center" aria-hidden>
          {avatares.map((c, i) => (
            <span
              key={c.key}
              className="-ml-1.5 grid h-7 w-7 place-items-center rounded-full border-2 border-card bg-tinta text-[9.5px] font-bold text-tinta-foreground first:ml-0"
              style={{ zIndex: avatares.length - i }}
            >
              {c.displayName
                .replace(/[^\p{L}\s]/gu, " ")
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase() ?? "")
                .join("") || "?"}
            </span>
          ))}
          {alemDosAvatares > 0 && (
            <span className="-ml-1.5 grid h-7 min-w-7 place-items-center rounded-full border-2 border-card bg-muted px-1 text-[10px] font-bold">
              +{alemDosAvatares}
            </span>
          )}
        </div>
      )}
    </KpiTile>
  );
}

/** O Comando de sempre: Tarefas + Próximas agendas (sem a flag). */
function ComandoClassico() {
  const { isAdmin } = useComandoScope();

  // Os dois hooks abaixo rodam TAMBÉM dentro dos cards. Não há fetch dobrado:
  // as queryKeys são idênticas e o TanStack Query serve do mesmo cache. É o que
  // permite o resumo do topo sem furar o encapsulamento dos blocos.
  //
  // ⚠️ Por isso o escopo precisa ser calculado IGUAL aqui e no card: as
  // queryKeys de ambos carregam o escopo, e pedir escopo diferente do card não
  // reaproveitaria o cache — dispararia uma segunda consulta e o número do topo
  // passaria a discordar da lista logo abaixo dele.
  const fila = useConversasAguardando(10);
  const { total: aguardando, isLoading: convLoading, isError: convError, chipsComErro } = fila;
  const reunioes = useReunioesHoje();
  const { total:pendentesCount,overdue:atrasadasCount,isLoading:taskLoading,isError:taskError } = useComandoTasks();

  const resumo = useMemo(() => {
    if (convError || taskError || chipsComErro > 0) return "Alguns dados não carregaram. Confira os avisos nos cards abaixo.";
    if (convLoading || taskLoading) return "Conferindo o dia…";
    const partes: string[] = [];
    if (aguardando > 0) {
      partes.push(
        `${aguardando} ${aguardando === 1 ? "cliente esperando" : "clientes esperando"}`,
      );
    }
    if (pendentesCount > 0) {
      partes.push(
        `${pendentesCount} ${pendentesCount === 1 ? "tarefa aberta" : "tarefas abertas"}`,
      );
    }
    if (atrasadasCount > 0) {
      partes.push(
        `${atrasadasCount} ${atrasadasCount === 1 ? "atrasada" : "atrasadas"}`,
      );
    }
    if (partes.length === 0) {
      if (convLoading) return "Conferindo o dia…";
      return isAdmin
        ? "Nada esperando o time agora."
        : "Nada esperando você agora.";
    }
    return partes.join(" · ");
  }, [aguardando, pendentesCount, atrasadasCount, convLoading, taskLoading, convError, taskError, chipsComErro, isAdmin]);

  // Só os estados que NÃO são número viram frase: carregando, erro, nada a fazer.
  // Com número, os três cartões abaixo já dizem o resumo.
  const resumoEhEstado =
    convError || taskError || chipsComErro > 0 || convLoading || taskLoading ||
    (aguardando === 0 && pendentesCount === 0 && atrasadasCount === 0);
  const carregando = convLoading || taskLoading;
  const valor = (n: number, erro: boolean) => (erro ? "—" : carregando ? "·" : n.toLocaleString("pt-BR"));

  return (
    <div className="flex flex-col gap-4">
      {/* O estado (carregando, erro, nada esperando) — com número, os cartões
          já dizem o resumo. */}
      {resumoEhEstado && <p className="-mt-1 text-[12px] text-muted-foreground">{resumo}</p>}

      <KpiRow cols={4}>
        <TileClientesEsperando fila={fila} isAdmin={isAdmin} />
        <KpiTile
          label="Tarefas abertas"
          value={valor(pendentesCount, taskError)}
          icon={ListChecks}
          tone="info"
          loading={taskLoading}
          note="Suas, em aberto"
        />
        <KpiTile
          label="Atrasadas"
          value={valor(atrasadasCount, taskError)}
          icon={AlarmClock}
          tone={atrasadasCount > 0 ? "bad" : "good"}
          loading={taskLoading}
          note={atrasadasCount > 0 ? "Passaram do prazo" : "Nada passou do prazo"}
        />
        <TileReunioesHoje reunioes={reunioes} />
      </KpiRow>

      {/* Herói: quem falou e não foi respondido — o único bloco que é dinheiro
          escapando. Embaixo, metas e tarefas em 2/3 (o gráfico precisa de
          largura) e a agenda à direita — as duas colunas terminam juntas, sem
          bancada vazia sob as metas. */}
      <CardConversasAguardando />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <CardMetas />
          <CardTarefasDoDia />
        </div>
        <div className="min-w-0">
          <CardProximasAgendas />
        </div>
      </div>
    </div>
  );
}