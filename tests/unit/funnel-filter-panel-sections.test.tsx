import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  KanbanFilterPanel,
  countActiveFilters,
  getFilterChips,
  type FilterSectionConfig,
} from "@/modules/pipelines/components/kanban/KanbanFilterPanel";
import {
  applyPeriodShortcut,
  createInitialPeriodState,
  getDateRange,
  matchPeriodShortcut,
  type MetricsPeriodState,
} from "@/lib/metrics-period";

/**
 * Os dois filtros que o redesenho (Modelo 1) tirou do cabeçalho e transformou
 * em SEÇÃO do painel de Filtros — SCRUM-67 ("Criados no período") e SCRUM-69
 * (faixa de tempo da reunião, em Confirmação).
 *
 * Por que estes testes existem: a faixa de controles do funil foi enxugada a
 * seis itens, e o que saiu de lá não podia simplesmente sumir. Um filtro que
 * desce pro painel herda três obrigações que, no cabeçalho, ele não tinha —
 * contar no badge, virar chip removível e ter um caminho de volta. Cada uma
 * delas quebra silenciosamente:
 *
 *  1. **Badge mentiroso.** "Criados no período" com só a data inicial marcada
 *     não recorta nada (`getDateRange` devolve null). Se o contador olhasse
 *     `period !== "all"` em vez do range, o painel anunciaria "1 filtro ativo"
 *     sem nenhum card sair da tela — e o operador procuraria o filtro fantasma.
 *  2. **Filtro sem volta.** Em Confirmação a opção "Todos" era justamente o
 *     botão de desligar da fileira antiga; dentro do painel ela não é
 *     renderada (seria um botão morto). O caminho de volta virou "clicar de
 *     novo na opção ativa". Sem isso, quem marca "Atrasadas" fica preso no
 *     recorte e conclui que o funil esvaziou.
 *  3. **Chip que não fecha.** O chip é o único lugar onde o filtro aparece com
 *     o painel fechado. Se `onRemove` não devolver o valor neutro, o operador
 *     vê o chip, clica, e nada acontece.
 *
 * Cobre o componente reutilizável (`KanbanFilterPanel`) — que é onde as duas
 * seções vivem — e guarda o resíduo do cabeçalho antigo em `PipeConfirmacao`.
 */

// ── jsdom polyfills p/ Radix (Sheet + ScrollArea + Popover) ─────────────────
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(() => cleanup());

/** Abre o painel (Sheet) — as seções só existem depois disto. */
function openPanel(sections: FilterSectionConfig[], onClearAll = vi.fn()) {
  render(<KanbanFilterPanel sections={sections} onClearAll={onClearAll} />);
  fireEvent.click(screen.getByRole("button", { name: /filtros/i }));
}

/**
 * As opções de faixa de tempo da reunião, exatamente como `PipeConfirmacao`
 * as entrega ao painel: sem o "Todos", que virou o `allValue`.
 */
const REUNIAO_OPTIONS = [
  { value: "today", label: "Hoje" },
  { value: "tomorrow", label: "Amanhã" },
  { value: "week", label: "Semana" },
  { value: "overdue", label: "Atrasadas" },
];

function reuniaoSection(
  value: string,
  onChange: (v: string) => void,
): FilterSectionConfig {
  return {
    type: "single-choice",
    id: "time-bucket",
    label: "Reunião",
    value,
    onChange,
    options: REUNIAO_OPTIONS,
    allValue: "all",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// inv:H2-06 — "Criados no período"
// ─────────────────────────────────────────────────────────────────────────────
describe("inv:H2-06 — 'Criados no período' é seção do painel de Filtros", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-29T15:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const base = () => createInitialPeriodState();

  it("a seção aparece DENTRO do painel, com os atalhos de período", () => {
    const onChange = vi.fn();
    openPanel([{ type: "created-period", value: base(), onChange }]);

    // O título da seção é o que prova que o filtro mudou de casa.
    expect(screen.getByText("Criados no período")).toBeInTheDocument();
    for (const label of ["7 dias", "30 dias", "90 dias", "Este mês"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // O intervalo livre continua acessível — o atalho não substituiu a data a data.
    expect(screen.getByRole("button", { name: /escolher datas/i })).toBeInTheDocument();
  });

  it("com o painel FECHADO a seção não existe — ela é do painel, não do cabeçalho", () => {
    render(
      <KanbanFilterPanel
        sections={[{ type: "created-period", value: base(), onChange: vi.fn() }]}
        onClearAll={vi.fn()}
      />,
    );
    expect(screen.queryByText("Criados no período")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "30 dias" })).not.toBeInTheDocument();
  });

  it("clicar em '30 dias' devolve um estado que realmente recorta os últimos 30 dias", () => {
    const onChange = vi.fn();
    openPanel([{ type: "created-period", value: base(), onChange }]);

    fireEvent.click(screen.getByRole("button", { name: "30 dias" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as MetricsPeriodState;
    expect(matchPeriodShortcut(next)).toBe("30d");
    expect(getDateRange(next)).not.toBeNull();
  });

  it("clicar no atalho JÁ ativo desliga o período — sem isso não há volta pelo painel", () => {
    const onChange = vi.fn();
    const ativo = applyPeriodShortcut("7d", base());
    openPanel([{ type: "created-period", value: ativo, onChange }]);

    const btn = screen.getByRole("button", { name: "7 dias" });
    expect(btn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(btn);
    const next = onChange.mock.calls[0][0] as MetricsPeriodState;
    expect(getDateRange(next)).toBeNull();
    expect(matchPeriodShortcut(next)).toBeNull();
  });

  it("'Limpar período' só aparece quando há período — nada de botão morto", () => {
    openPanel([{ type: "created-period", value: base(), onChange: vi.fn() }]);
    expect(screen.queryByRole("button", { name: /limpar período/i })).not.toBeInTheDocument();

    cleanup();
    openPanel([
      { type: "created-period", value: applyPeriodShortcut("90d", base()), onChange: vi.fn() },
    ]);
    expect(screen.getByRole("button", { name: /limpar período/i })).toBeInTheDocument();
  });

  it("badge NÃO acende com seleção pela metade — só a data inicial não filtra nada", () => {
    const meio: MetricsPeriodState = {
      ...base(),
      period: "custom",
      customRange: { from: new Date("2026-07-01"), to: undefined },
    };
    expect(getDateRange(meio)).toBeNull(); // premissa
    expect(
      countActiveFilters([{ type: "created-period", value: meio, onChange: vi.fn() }]),
    ).toBe(0);
  });

  it("badge acende com período completo e não acende no estado inicial", () => {
    expect(
      countActiveFilters([{ type: "created-period", value: base(), onChange: vi.fn() }]),
    ).toBe(0);
    expect(
      countActiveFilters([
        { type: "created-period", value: applyPeriodShortcut("7d", base()), onChange: vi.fn() },
      ]),
    ).toBe(1);
  });

  it("vira chip 'Criados: …' e o chip devolve o estado ao neutro", () => {
    const onChange = vi.fn();
    const chips = getFilterChips([
      { type: "created-period", value: applyPeriodShortcut("7d", base()), onChange },
    ]);

    expect(chips).toHaveLength(1);
    expect(chips[0].id).toBe("created-period");
    expect(chips[0].label).toMatch(/^Criados: /);

    chips[0].onRemove();
    const next = onChange.mock.calls[0][0] as MetricsPeriodState;
    expect(getDateRange(next)).toBeNull();
  });

  it("seleção pela metade também não vira chip", () => {
    const meio: MetricsPeriodState = {
      ...base(),
      period: "custom",
      customRange: { from: new Date("2026-07-01"), to: undefined },
    };
    expect(getFilterChips([{ type: "created-period", value: meio, onChange: vi.fn() }])).toEqual([]);
  });

  it("o rótulo do chip lê a data do ISO, não do fuso local (Brasil é UTC-3)", () => {
    // getDateRange normaliza as pontas em UTC: 01/03 vira "2026-03-01T00:00:00Z".
    // Reidratar isso com `new Date(iso)` num fuso negativo joga o rótulo pro dia
    // anterior — "Criados: 28 fev" pra quem escolheu 1º de março.
    const custom: MetricsPeriodState = {
      ...base(),
      period: "custom",
      customRange: { from: new Date(2026, 2, 1), to: new Date(2026, 2, 15) },
    };
    const [chip] = getFilterChips([{ type: "created-period", value: custom, onChange: vi.fn() }]);
    expect(chip.label).toBe("Criados: 01 mar – 15 mar");
  });

  it("intervalo de um dia só não vira 'x – x'", () => {
    const umDia: MetricsPeriodState = {
      ...base(),
      period: "custom",
      customRange: { from: new Date(2026, 2, 9), to: new Date(2026, 2, 9) },
    };
    const [chip] = getFilterChips([{ type: "created-period", value: umDia, onChange: vi.fn() }]);
    expect(chip.label).toBe("Criados: 09 mar");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inv:H2-07 — faixa de tempo da reunião (Confirmação)
// ─────────────────────────────────────────────────────────────────────────────
describe("inv:H2-07 — faixa de tempo da reunião virou seção do painel (Confirmação)", () => {
  it("a seção 'Reunião' aparece no painel com as quatro faixas", () => {
    openPanel([reuniaoSection("all", vi.fn())]);

    expect(screen.getByText("Reunião")).toBeInTheDocument();
    for (const opt of REUNIAO_OPTIONS) {
      expect(screen.getByRole("button", { name: opt.label })).toBeInTheDocument();
    }
  });

  it("'Todos' NÃO é renderado — a ausência de filtro não é uma opção clicável", () => {
    openPanel([reuniaoSection("all", vi.fn())]);
    expect(screen.queryByRole("button", { name: "Todos" })).not.toBeInTheDocument();
  });

  it("escolher uma faixa avisa o funil com o valor daquela faixa", () => {
    const onChange = vi.fn();
    openPanel([reuniaoSection("all", onChange)]);

    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    expect(onChange).toHaveBeenCalledWith("today");
  });

  it("clicar na faixa ATIVA volta pra 'all' — é o único caminho de volta", () => {
    const onChange = vi.fn();
    openPanel([reuniaoSection("overdue", onChange)]);

    const btn = screen.getByRole("button", { name: "Atrasadas" });
    expect(btn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("só a faixa escolhida fica marcada — a escolha é única, não acumula", () => {
    openPanel([reuniaoSection("week", vi.fn())]);

    expect(screen.getByRole("button", { name: "Semana" })).toHaveAttribute("aria-pressed", "true");
    for (const label of ["Hoje", "Amanhã", "Atrasadas"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("badge conta a faixa só quando ela recorta algo", () => {
    expect(countActiveFilters([reuniaoSection("all", vi.fn())])).toBe(0);
    expect(countActiveFilters([reuniaoSection("overdue", vi.fn())])).toBe(1);
  });

  it("badge respeita um valor neutro diferente de 'all'", () => {
    // A seção é genérica: quem a usa declara qual valor significa "sem filtro".
    // Ignorar `allValue` faria o badge contar o estado neutro como filtro ativo.
    const neutro: FilterSectionConfig = {
      type: "single-choice",
      id: "faixa",
      label: "Faixa",
      value: "qualquer",
      onChange: vi.fn(),
      options: [{ value: "qualquer", label: "Qualquer" }, { value: "hoje", label: "Hoje" }],
      allValue: "qualquer",
    };
    expect(countActiveFilters([neutro])).toBe(0);
    expect(countActiveFilters([{ ...neutro, value: "hoje" }])).toBe(1);
  });

  it("vira chip 'Reunião: Atrasadas' e o chip devolve pra 'all'", () => {
    const onChange = vi.fn();
    const chips = getFilterChips([reuniaoSection("overdue", onChange)]);

    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("Reunião: Atrasadas");

    chips[0].onRemove();
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("o chip carrega o id da seção — duas seções desse tipo não se sobrepõem", () => {
    const chips = getFilterChips([
      reuniaoSection("today", vi.fn()),
      {
        type: "single-choice",
        id: "faixa-visita",
        label: "Visita",
        value: "week",
        onChange: vi.fn(),
        options: [{ value: "week", label: "Semana" }],
      },
    ]);
    expect(chips.map((c) => c.id)).toEqual(["time-bucket", "faixa-visita"]);
  });

  it("no estado neutro não há chip nenhum", () => {
    expect(getFilterChips([reuniaoSection("all", vi.fn())])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Os dois juntos — é a composição que o cabeçalho antigo não permitia
// ─────────────────────────────────────────────────────────────────────────────
describe("os dois filtros convivem no mesmo painel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-29T15:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const sections = (): FilterSectionConfig[] => [
    {
      type: "created-period",
      value: applyPeriodShortcut("30d", createInitialPeriodState()),
      onChange: vi.fn(),
    },
    reuniaoSection("today", vi.fn()),
  ];

  it("o badge soma os dois", () => {
    expect(countActiveFilters(sections())).toBe(2);
  });

  it("as duas seções aparecem no mesmo painel, e o cabeçalho anuncia '2 filtros ativos'", () => {
    openPanel(sections());
    expect(screen.getByText("Criados no período")).toBeInTheDocument();
    expect(screen.getByText("Reunião")).toBeInTheDocument();
    expect(screen.getByText(/2 filtros ativos/i)).toBeInTheDocument();
  });

  it("tirar um chip não mexe no outro filtro", () => {
    const onPeriod = vi.fn();
    const onReuniao = vi.fn();
    const chips = getFilterChips([
      {
        type: "created-period",
        value: applyPeriodShortcut("30d", createInitialPeriodState()),
        onChange: onPeriod,
      },
      reuniaoSection("today", onReuniao),
    ]);

    chips.find((c) => c.id === "created-period")!.onRemove();
    expect(onPeriod).toHaveBeenCalledTimes(1);
    expect(onReuniao).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resíduo do cabeçalho antigo em Confirmação
// ─────────────────────────────────────────────────────────────────────────────
describe("a página unificada não guarda a fileira de botões antiga (SCRUM-637)", () => {
  // Resolve a partir da raiz do projeto (cwd do Vitest) — `import.meta.url`
  // não é um file:// depois da transformação do Vite. A página velha de
  // Confirmação morreu no flip; a obrigação passou pra página unificada
  // (seções extras) + `useFunilFilters` (seções universais, SCRUM-633).
  const source = readFileSync(
    resolve(process.cwd(), "src/modules/pipelines/pages/Funil.tsx"),
    "utf8",
  );
  const controllerSource = readFileSync(
    resolve(process.cwd(), "src/modules/pipelines/hooks/model/useFunilFilters.ts"),
    "utf8",
  );

  it("entrega as faixas de reunião ao painel de Filtros", () => {
    expect(source).toMatch(/type:\s*["']single-choice["']/);
    expect(source).toMatch(/label:\s*["']Reunião["']/);
    expect(source).toMatch(/TIME_OPTIONS/);
  });

  it("não renderiza mais os botões de faixa soltos no cabeçalho", () => {
    // Era `timeOptions.map(...)` numa fileira acima do board. Se voltar, o
    // operador passa a ter dois lugares para o mesmo filtro — e eles divergem.
    expect(source).not.toMatch(/TIME_OPTIONS\.map\(/);
  });

  it("guarda 'Criados no período' como seção, não como seletor próprio", () => {
    expect(controllerSource).toMatch(/type:\s*["']created-period["']/);
    expect(source).not.toMatch(/<MetricsPeriodSelector/);
    expect(controllerSource).not.toMatch(/<MetricsPeriodSelector/);
  });
});
