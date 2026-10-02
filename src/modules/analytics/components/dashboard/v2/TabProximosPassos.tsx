import { useMemo } from "react";
import { AlarmClock, ListChecks, MessageSquareDot } from "lucide-react";
import { KpiTile } from "@/components/ui/bento";
import { useAcoesDoDia } from "@/modules/engagement";
import { useOrganization } from "@/modules/identity";
import { classificarTarefas } from "@/modules/analytics/lib/tarefas-do-dia";
import { useComandoScope } from "@/modules/analytics/hooks/useComandoScope";
import { useConversasAguardando } from "@/modules/analytics/hooks/useConversasAguardando";
import { CardConversasAguardando } from "./CardConversasAguardando";
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
  const { total: aguardando, isLoading: convLoading, isError: convError, chipsComErro } = useConversasAguardando(10);
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

  return (
    <div className="space-y-5 pt-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-bold tracking-[-0.02em]">
          {isAdmin ? "Central de trabalho da equipe" : "Sua central de trabalho"}
        </h2>
        {resumoEhEstado && <p className="text-[12px] text-muted-foreground">{resumo}</p>}
      </header>

      {/* V5: o resumo do topo vira número. Mesmos três valores da frase de
          antes, do mesmo cache — o cartão nunca discorda da lista abaixo. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiTile
          label="Clientes esperando"
          value={valor(aguardando, convError)}
          icon={MessageSquareDot}
          tone={aguardando > 0 ? "gold" : "neutral"}
          loading={convLoading}
          note={isAdmin ? "Fila de resposta da equipe" : "Na sua fila de resposta"}
        />
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
      </div>

      {/* Herói: quem falou e não foi respondido — o único bloco que é dinheiro
          escapando. Embaixo, à esquerda, metas (precisam de largura para a
          lista de vendedores); à direita, agenda e tarefas, listas curtas.
          Abaixo de lg tudo vira uma coluna só, na mesma ordem de prioridade. */}
      <CardConversasAguardando />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <CardMetas />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <CardProximasAgendas />
          <CardTarefasDoDia />
        </div>
      </div>
    </div>
  );
}
