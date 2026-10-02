import { useMemo } from "react";
import { AlarmClock, CalendarCheck, ListChecks, MessageSquareDot } from "lucide-react";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import { useAcoesDoDia } from "@/modules/engagement";
import { useOrganization } from "@/modules/identity";
import { classificarTarefas } from "@/modules/analytics/lib/tarefas-do-dia";
import { useComandoScope } from "@/modules/analytics/hooks/useComandoScope";
import { useConversasAguardando } from "@/modules/analytics/hooks/useConversasAguardando";
import { useComandoAgenda } from "@/modules/analytics/hooks/useComandoAgenda";
import { CardConversasAguardando, esperaCurta } from "./CardConversasAguardando";
import { CardProximasAgendas } from "./CardProximasAgendas";
import { CardTarefasDoDia } from "./CardTarefasDoDia";
import { CardMetas } from "./CardMetas";

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
 */
export function TabProximosPassos() {
  const { timezone } = useOrganization();
  const { isAdmin } = useComandoScope();

  // Os dois hooks abaixo rodam TAMBÉM dentro dos cards. Não há fetch dobrado:
  // as queryKeys são idênticas e o TanStack Query serve do mesmo cache. É o que
  // permite o resumo do topo sem furar o encapsulamento dos blocos.
  //
  // ⚠️ Por isso o escopo precisa ser calculado IGUAL aqui e no card: as
  // queryKeys de ambos carregam o escopo, e pedir escopo diferente do card não
  // reaproveitaria o cache — dispararia uma segunda consulta e o número do topo
  // passaria a discordar da lista logo abaixo dele.
  const { total: aguardando, items: filaItems, isLoading: convLoading, isError: convError, chipsComErro } = useConversasAguardando(10);

  // Reuniões de hoje: janela do dia, derivada uma vez por dia (mesmo cuidado
  // de `CardProximasAgendas` com a queryKey).
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
  const reunioesHoje = useMemo(() => {
    const doDia = (agendaHoje.data ?? []).filter(
      (e) => e.event_type === "meeting" && !["cancelled", "canceled"].includes((e.status ?? "").toLowerCase()),
    );
    return { total: doDia.length, realizadas: doDia.filter((e) => (e.status ?? "").toLowerCase() === "completed").length };
  }, [agendaHoje.data]);
  const { data: tarefas, isLoading: taskLoading, isError: taskError } = useAcoesDoDia(isAdmin ? "tudo" : "meu");

  const { pendentes, atrasadasCount } = useMemo(
    () => classificarTarefas(tarefas, timezone),
    [tarefas, timezone],
  );

  const resumo = useMemo(() => {
    if (convError || taskError || chipsComErro > 0) return "Alguns dados não carregaram. Confira os avisos nos cards abaixo.";
    if (convLoading || taskLoading) return "Conferindo o dia…";
    const partes: string[] = [];
    if (aguardando > 0) {
      partes.push(
        `${aguardando} ${aguardando === 1 ? "cliente esperando" : "clientes esperando"}`,
      );
    }
    if (pendentes.length > 0) {
      partes.push(
        `${pendentes.length} ${pendentes.length === 1 ? "tarefa aberta" : "tarefas abertas"}`,
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
  }, [aguardando, pendentes.length, atrasadasCount, convLoading, taskLoading, convError, taskError, chipsComErro, isAdmin]);

  // Só os estados que NÃO são número viram frase: carregando, erro, nada a fazer.
  // Com número, os três cartões abaixo já dizem o resumo.
  const resumoEhEstado =
    convError || taskError || chipsComErro > 0 || convLoading || taskLoading ||
    (aguardando === 0 && pendentes.length === 0 && atrasadasCount === 0);
  const carregando = convLoading || taskLoading;
  const valor = (n: number, erro: boolean) => (erro ? "—" : carregando ? "·" : n.toLocaleString("pt-BR"));

  const maisAntigo = useMemo(() => {
    const vezes = (filaItems ?? []).map((c) => c.lastClientMessageAt).filter(Boolean).sort();
    return vezes[0] ? esperaCurta(vezes[0]) : null;
  }, [filaItems]);
  const avatares = (filaItems ?? []).slice(0, 5);
  const alemDosAvatares = Math.max(0, aguardando - avatares.length);

  return (
    <div className="flex flex-col gap-4">
      {/* O estado (carregando, erro, nada esperando) — com número, os cartões
          já dizem o resumo. */}
      {resumoEhEstado && <p className="-mt-1 text-[12px] text-muted-foreground">{resumo}</p>}

      <KpiRow cols={4}>
        <KpiTile
          label="Clientes esperando"
          value={valor(aguardando, convError)}
          icon={MessageSquareDot}
          tone={aguardando > 0 ? "gold" : "neutral"}
          loading={convLoading}
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
        <KpiTile
          label="Tarefas abertas"
          value={valor(pendentes.length, taskError)}
          icon={ListChecks}
          tone="info"
          loading={taskLoading}
          note={isAdmin ? "Do time, para hoje" : "Suas, para hoje"}
        />
        <KpiTile
          label="Atrasadas"
          value={valor(atrasadasCount, taskError)}
          icon={AlarmClock}
          tone={atrasadasCount > 0 ? "bad" : "good"}
          loading={taskLoading}
          note={atrasadasCount > 0 ? "Passaram do prazo" : "Nada passou do prazo"}
        />
        <KpiTile
          label="Reuniões hoje"
          value={agendaHoje.isError ? "—" : agendaHoje.isLoading ? "·" : reunioesHoje.total.toLocaleString("pt-BR")}
          icon={CalendarCheck}
          tone="info"
          loading={agendaHoje.isLoading}
          note={
            reunioesHoje.total === 0
              ? "Nenhuma marcada para hoje"
              : `${reunioesHoje.realizadas} ${reunioesHoje.realizadas === 1 ? "realizada" : "realizadas"}`
          }
        />
      </KpiRow>

      {/* Herói: quem falou e não foi respondido — o único bloco que é dinheiro
          escapando. Embaixo, metas em 2/3 (precisam de largura para o
          gráfico) e, à direita, agenda e tarefas, listas curtas. */}
      <CardConversasAguardando />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <CardMetas />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <CardProximasAgendas />
          <CardTarefasDoDia />
        </div>
      </div>
    </div>
  );
}
