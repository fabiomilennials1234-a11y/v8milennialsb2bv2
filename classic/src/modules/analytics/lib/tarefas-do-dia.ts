import type { AcaoDoDia } from "@/modules/engagement";
import { zonedDayStart } from "@/shared/time/zoned-day";

/**
 * A regra de "atrasada" da central de trabalho, isolada e PURA.
 *
 * Vive aqui, e não dentro do card, porque o cabeçalho do Comando precisa do
 * mesmo número que a lista — e duas implementações da mesma regra divergem na
 * primeira semana. É também o único jeito de testar a virada do dia sem montar
 * componente.
 *
 * ⚠️ `acoes_do_dia` NÃO tem coluna de prazo. O prazo é o próprio dia, que é o
 * que o nome da tabela diz: tarefa não concluída criada antes de hoje está
 * atrasada. Se um dia a tabela ganhar `due_date`, é ESTA função que muda, e só
 * ela.
 *
 * O corte usa o fuso da ORG, não o do browser: a mesma org tem de ver a mesma
 * lista de atrasadas independentemente de onde o vendedor abriu a tela.
 */

export interface TarefaClassificada {
  tarefa: AcaoDoDia;
  atrasada: boolean;
}

export interface TarefasDoDia {
  /** Não concluídas, atrasadas primeiro. */
  pendentes: TarefaClassificada[];
  /** Concluídas HOJE — fora da lista principal, mas com porta para desfazer. */
  concluidasHoje: AcaoDoDia[];
  atrasadasCount: number;
}

/**
 * @param agora injetável para teste — a virada do dia é justamente o que
 *              precisa ser exercitado, e ela é invisível se o relógio for
 *              lido de dentro da função.
 */
export function classificarTarefas(
  tarefas: AcaoDoDia[] | undefined,
  timezone: string | null | undefined,
  agora: Date = new Date(),
): TarefasDoDia {
  // `timezone` chega null nos primeiros renders (isReady não espera a query da
  // org). O fallback UTC é o mesmo que `zoned-day` já aplica quando o Intl
  // rejeita a zona, e no Brasil (UTC-3) ele erra para o lado seguro: o corte
  // UTC é mais cedo, então nunca acusa como atrasada uma tarefa de hoje.
  const inicioDeHoje = zonedDayStart(agora, timezone ?? "UTC").getTime();
  const todas = tarefas ?? [];

  const pendentes: TarefaClassificada[] = todas
    .filter((t) => !t.is_completed)
    .map((t) => ({
      tarefa: t,
      atrasada: new Date(t.created_at).getTime() < inicioDeHoje,
    }))
    .sort((a, b) => {
      if (a.atrasada !== b.atrasada) return a.atrasada ? -1 : 1;
      return a.tarefa.position - b.tarefa.position;
    });

  const concluidasHoje = todas.filter(
    (t) =>
      t.is_completed &&
      t.completed_at != null &&
      new Date(t.completed_at).getTime() >= inicioDeHoje,
  );

  return {
    pendentes,
    concluidasHoje,
    atrasadasCount: pendentes.filter((p) => p.atrasada).length,
  };
}
