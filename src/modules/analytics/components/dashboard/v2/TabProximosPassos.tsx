import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ChartNoAxesCombined } from "lucide-react";
import { useAcoesDoDia } from "@/modules/engagement";
import { useOrganization } from "@/modules/identity";
import { classificarTarefas } from "@/modules/analytics/lib/tarefas-do-dia";
import { useConversasAguardando } from "@/modules/analytics/hooks/useConversasAguardando";
import { CardConversasAguardando } from "./CardConversasAguardando";
import { CardProximasAgendas } from "./CardProximasAgendas";
import { CardTarefasDoDia } from "./CardTarefasDoDia";

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

  // Os dois hooks abaixo rodam TAMBÉM dentro dos cards. Não há fetch dobrado:
  // as queryKeys são idênticas e o TanStack Query serve do mesmo cache. É o que
  // permite o resumo do topo sem furar o encapsulamento dos blocos.
  const { total: aguardando, isLoading: convLoading } = useConversasAguardando(10);
  const { data: tarefas } = useAcoesDoDia();

  const { pendentes, atrasadasCount } = useMemo(
    () => classificarTarefas(tarefas, timezone),
    [tarefas, timezone],
  );

  const resumo = useMemo(() => {
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
      return convLoading ? "Conferindo o dia…" : "Nada esperando você agora.";
    }
    return partes.join(" · ");
  }, [aguardando, pendentes.length, atrasadasCount, convLoading]);

  return (
    <div className="space-y-5 pt-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[22px] font-extrabold leading-tight tracking-[-0.03em]">
            Sua central de trabalho
          </h2>
          <p className="text-[12px] text-muted-foreground/70">{resumo}</p>
        </div>

        {/* Comando é operação; análise vive no Estúdio. O par precisa de uma
            porta explícita, senão a separação vira dois produtos. */}
        <Link
          to="/metricas"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <ChartNoAxesCombined className="h-3.5 w-3.5" />
          Ver métricas
        </Link>
      </header>

      {/* Desktop-first, como o produto é usado. O bloco 1 fica com a coluna
          larga porque é o único que representa oportunidade perdida; agenda e
          tarefas empilham na coluna estreita. Abaixo de lg tudo vira uma
          coluna só, na mesma ordem de prioridade. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <CardConversasAguardando />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <CardProximasAgendas />
          <CardTarefasDoDia />
        </div>
      </div>
    </div>
  );
}
