import { describe, it, expect } from "vitest";
import { percentualDaMeta } from "./useMetricWindowData";

/**
 * O termômetro da meta (SCRUM-389).
 *
 * A família `meta` do inventário NÃO virou medida nova: o motor já devolve
 * `target` no payload de toda medida com `goal_type` no catálogo, desde
 * `20260727140000`. O que faltava era a UI ler. Escrever SQL novo aqui teria
 * criado uma SEGUNDA verdade sobre meta — o mesmo defeito que o card avisava.
 *
 * O que este teste guarda é a aritmética, que é onde a família erra:
 * `percent_1` apenas SUFIXA "%", então quem não multiplicar por 100 imprime
 * "0,9%" para uma meta 87% batida.
 */
describe("percentualDaMeta — a multiplicação que o formatador não faz", () => {
  it("multiplica por 100: 87 de 100 é 87%, não 0,87%", () => {
    expect(percentualDaMeta(87, 100)).toBe(87);
  });

  it("passa de 100 quando a meta é superada — o número não satura", () => {
    // A BARRA satura em 100% (é uma caixa); o número não, porque 137% é
    // informação que o gestor quer.
    expect(percentualDaMeta(137, 100)).toBeCloseTo(137);
  });

  it("meta ZERO devolve ausência, não infinito", () => {
    // Sem esta borda, "∞% da meta" chega na tela — pior que não mostrar nada.
    expect(percentualDaMeta(50, 0)).toBeNull();
  });

  it("sem alvo (medida sem goal_type, ou mês sem meta cadastrada) é ausência", () => {
    expect(percentualDaMeta(50, null)).toBeNull();
    expect(percentualDaMeta(50, undefined)).toBeNull();
  });

  it("sem valor medido é ausência — não conta como 0% da meta", () => {
    // Zero por cento afirma que nada foi feito; ausência afirma que não se
    // sabe. Período ainda carregando não pode acusar o time.
    expect(percentualDaMeta(null, 100)).toBeNull();
  });

  it("valor zero COM meta é 0% — aqui a afirmação é verdadeira", () => {
    expect(percentualDaMeta(0, 100)).toBe(0);
  });

  it("meta negativa não é tratada como especial — a conta é a conta", () => {
    // Não existe meta negativa no produto, mas inventar uma regra para ela
    // esconderia o cadastro errado em vez de mostrá-lo.
    expect(percentualDaMeta(50, -100)).toBe(-50);
  });
});
