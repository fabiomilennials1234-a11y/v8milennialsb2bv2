import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { computePeriodRange } from "@/modules/analytics/hooks/useCommandMetrics";
import { periodoAtual } from "@/modules/analytics/lib/metrics-studio-period";
import { mesDeReferencia } from "@/modules/analytics/lib/metrics-studio-mes-referencia";

/**
 * O Estúdio mede o mesmo mês nos DOIS caminhos.
 *
 * Card sob medida recebe um intervalo resolvido no cliente
 * (`computePeriodRange`). Janela de métrica manda a data de referência crua e
 * deixa `metric_period_bounds` cortar no servidor (`periodoAtual`). São
 * caminhos diferentes de propósito — o que não pode divergir é QUAL MÊS cada um
 * acaba medindo.
 *
 * Divergiam: a página passava `agora.getMonth()` (0-based) a um parâmetro
 * 1-based, e o preset "Mês" — o default da tela — media o mês anterior só do
 * lado do card sob medida. Sem erro, sem aviso, dois números plausíveis lado a
 * lado. É o mesmo formato do defeito já registrado no projeto ("Dashboard
 * 'Hoje' conta UTC, lista mostra BRT").
 */

/** Ano-mês de um instante, em UTC — `computePeriodRange` devolve fronteiras UTC. */
const ymUTC = (d: Date): string => d.toISOString().slice(0, 7);
/** Ano-mês da data de calendário que viaja para o motor (`YYYY-MM-DD`). */
const ymRef = (ref: string): string => ref.slice(0, 7);

describe("mesDeReferencia", () => {
  it("conta o mês a partir de 1, que é a convenção de computePeriodRange", () => {
    expect(mesDeReferencia(new Date(2026, 0, 15))).toEqual({ month: 1, year: 2026 });
    expect(mesDeReferencia(new Date(2026, 8, 4))).toEqual({ month: 9, year: 2026 });
    expect(mesDeReferencia(new Date(2026, 11, 31))).toEqual({ month: 12, year: 2026 });
  });

  it("é a MESMA convenção que o Comando usa nos seus chamadores", () => {
    // Dashboard.tsx, Performance.tsx e TVDashboard.tsx passam `getMonth() + 1`.
    // Se algum dia isso mudar, este teste morre junto — que é o ponto.
    const agora = new Date(2026, 8, 4);
    expect(mesDeReferencia(agora).month).toBe(agora.getMonth() + 1);
  });
});

describe("Estúdio: card sob medida e janela de métrica medem o mesmo mês", () => {
  // Doze meses, porque o erro tinha cara de acidente de borda e não era: ele
  // valia o ano inteiro. Janeiro entra por causa da virada de ano — com o
  // índice 0-based ele pedia `month = 0`, que `Date.UTC` lê como dezembro do
  // ano ANTERIOR.
  const DIAS = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 15));

  it.each(DIAS)("mês de %s bate entre os dois caminhos", (agora) => {
    const { month, year } = mesDeReferencia(agora);
    const intervalo = computePeriodRange("month", month, year);
    const motor = periodoAtual("month", agora);

    expect(motor.ref).not.toBeNull();
    expect(ymUTC(intervalo.start)).toBe(ymRef(motor.ref!));
    expect(ymUTC(intervalo.end)).toBe(ymRef(motor.ref!));
  });

  it("o intervalo cobre o mês inteiro, da primeira à última hora", () => {
    const intervalo = computePeriodRange("month", 9, 2026);
    expect(intervalo.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(intervalo.end.toISOString()).toBe("2026-09-30T23:59:59.999Z");
  });

  /**
   * A regressão, escrita como ela se manifestava. Não é teste do bug pelo bug:
   * é o que distingue "somei 1" de "somei 1 no lugar certo" — passar o índice
   * cru continua compilando e continua devolvendo um intervalo plausível.
   */
  it("o índice 0-based do Date mediria o mês anterior — por isso não se passa ele", () => {
    const agora = new Date(2026, 8, 4); // setembro
    const errado = computePeriodRange("month", agora.getMonth(), agora.getFullYear());
    expect(ymUTC(errado.start)).toBe("2026-08");
    expect(ymUTC(errado.start)).not.toBe(ymRef(periodoAtual("month", agora).ref!));
  });

  it("em janeiro o índice 0-based cairia no ano anterior", () => {
    const agora = new Date(2026, 0, 15);
    const errado = computePeriodRange("month", agora.getMonth(), agora.getFullYear());
    expect(ymUTC(errado.start)).toBe("2025-12");
  });
});

/**
 * A varredura do corpo do repositório — a terceira amarra, no mesmo espírito de
 * `role-vocabulary.test.ts`.
 *
 * Os testes acima provam que `mesDeReferencia` está certa. Nenhum deles impede
 * alguém de escrever `getMonth()` direto na chamada outra vez, que é como o
 * defeito entrou. O tipo não ajuda: os dois são `number`, e o intervalo errado
 * continua sendo um intervalo válido.
 */
describe("nenhuma chamada a computePeriodRange passa o mês 0-based", () => {
  const RAIZ = resolve(__dirname, "../../src");

  // `withFileTypes` em vez de um `statSync` por entrada: a varredura de `src/`
  // com uma syscall extra por arquivo estourava o timeout padrão do vitest no
  // Windows sem que houvesse nada de errado com o código varrido.
  function arquivosTS(dir: string, saida: string[] = []): string[] {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name);
      if (entrada.isDirectory()) arquivosTS(caminho, saida);
      else if (/\.tsx?$/.test(entrada.name)) saida.push(caminho);
    }
    return saida;
  }

  it("o mês vem de mesDeReferencia ou de getMonth() + 1, nunca do índice cru", () => {
    const CHAMADA = "computePeriodRange(";
    const infratores: string[] = [];

    for (const arquivo of arquivosTS(RAIZ)) {
      const fonte = readFileSync(arquivo, "utf8");
      for (let i = fonte.indexOf(CHAMADA); i !== -1; i = fonte.indexOf(CHAMADA, i + 1)) {
        // A lista de argumentos cabe folgada em 200 chars nas chamadas reais; o
        // que importa é olhar os argumentos, não o corpo do arquivo inteiro.
        const args = fonte.slice(i + CHAMADA.length, i + CHAMADA.length + 200);
        // `getMonth()` sem o `+ 1` logo em seguida é exatamente o defeito.
        if (/getMonth\(\)\s*(?!\s*\+\s*1)/.test(args) && !/getMonth\(\)\s*\+\s*1/.test(args)) {
          const linha = fonte.slice(0, i).split("\n").length;
          infratores.push(`${arquivo.replace(RAIZ, "src")}:${linha}`);
        }
      }
    }

    expect(infratores).toEqual([]);
  }, 30_000);
});
