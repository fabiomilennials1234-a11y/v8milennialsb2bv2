/**
 * O mês de referência do Estúdio — e só isso.
 *
 * ── Por que uma função para somar 1 ──
 *
 * `computePeriodRange(period, month, year, ...)` recebe `month` **1-based**:
 * janeiro é 1. Está escrito na própria implementação, três vezes —
 * `Date.UTC(year, month - 1, 1)`, `MONTH_SHORT[prevMonth - 1]` e
 * `month === new Date().getMonth() + 1`. Todo chamador do Comando respeita isso
 * passando `getMonth() + 1` (`Dashboard.tsx`, `Performance.tsx`,
 * `TVDashboard.tsx`).
 *
 * O Estúdio passava `agora.getMonth()` — **0-based**. Em 04/09/2026 isso pedia
 * o mês 8, e o preset "Mês", que é o DEFAULT da tela, media **agosto**.
 *
 * ── Por que o erro não aparecia ──
 *
 * Só o card SOB MEDIDA usa este intervalo. A janela de métrica manda a data de
 * referência crua e deixa `metric_period_bounds` cortar no servidor
 * (`metrics-studio-period.ts`), então ela media setembro, certo. Os dois lado a
 * lado no mesmo painel mostravam **meses diferentes, sem erro e sem aviso** —
 * exatamente a falha que a fatia 1 dizia estar prevenindo ao mandar o intervalo
 * pronto de cima, e a mesma classe do defeito já registrado no projeto
 * ("Dashboard 'Hoje' conta UTC, lista mostra BRT").
 *
 * Um `+ 1` no meio de uma chamada de cinco argumentos não tem onde ser testado.
 * Aqui tem, e o teste pareado trava a concordância com o motor — que é a regra
 * de verdade, não o `+ 1`.
 *
 * Folha de propósito: não importa ninguém. É o que a deixa citável pelo teste,
 * pela página e por qualquer futuro chamador sem abrir aresta no grafo — a
 * lição que já custou `metrics-studio-window.ts` e
 * `metrics-studio-fixed-card-contract.ts` neste mesmo módulo.
 */

/** Mês/ano de referência para `computePeriodRange`, na convenção 1-based dela. */
export interface MesDeReferencia {
  /** 1 = janeiro. A convenção de `computePeriodRange`, não a de `Date`. */
  month: number;
  year: number;
}

/**
 * O "agora" do Estúdio na convenção que `computePeriodRange` espera.
 *
 * O Estúdio não tem seletor de mês como o Comando: o período é sempre relativo
 * a hoje. `agora` é injetável para o teste não depender do relógio.
 */
export function mesDeReferencia(agora: Date = new Date()): MesDeReferencia {
  return { month: agora.getMonth() + 1, year: agora.getFullYear() };
}
