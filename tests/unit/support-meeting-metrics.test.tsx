import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TabVisaoGeralV2 } from "@/modules/analytics/components/dashboard/v2/TabVisaoGeralV2";
import { TabPerformanceV2 } from "@/modules/analytics/components/dashboard/v2/TabPerformanceV2";

const mocks = vi.hoisted(() => ({ command: vi.fn(), cohort: vi.fn() }));
vi.mock("@/modules/analytics/hooks/useCommandMetrics", () => ({
  useCommandMetrics: (...args: unknown[]) => mocks.command(...args),
}));
vi.mock("@/modules/analytics/hooks/useFunnelHealth", () => ({
  useFunnelHealth: () => { mocks.cohort(); return { data: { stages: { reuniao: 61 } } }; },
}));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: "6030520a-2ca7-477d-be89-55758e2cd808" } }),
}));
vi.mock("@/modules/engagement", () => ({
  useFollowUps: () => ({ data: [] }),
  useTeamGoals: () => ({ data: [{ type: "reunioes_marcadas", target_value: 100 }], isLoading: false }),
}));
vi.mock("@/modules/analytics/hooks/useTeamResponseTime", () => ({
  useTeamResponseTime: () => ({ data: null, isLoading: false, isError: false }),
}));
vi.mock("@/shared/hooks/useCountUp", () => ({ useCountUp: (value: number) => value }));

const range = {
  start: new Date("2026-09-01T00:00:00-03:00"), end: new Date("2026-09-30T23:59:59.999-03:00"),
  prevStart: new Date("2026-08-01T00:00:00-03:00"), prevEnd: new Date("2026-08-31T23:59:59.999-03:00"),
  dayOfPeriod: 30, daysTotal: 30, prevLabel: "em agosto",
};
const base = {
  totalLeads: 100, reunioesMarcadas: 89, reunioesComparecidas: 47,
  funnelReunioesMarcadas: 89, funnelPropostas: 20, funnelVendas: 10,
  taxaConversao: 10, novosClientes: 10, propostasEnviadas: 20,
  vendaTotal: 1000, vendaMRR: 0, vendaProjeto: 1000, ticketMedio: 100,
  dailySales: [], noShow: 0, taxaNoShow: 0, vendaPrimeiroPedido: 1000, vendaBaseAtiva: 0,
};
function overview(section: "kpis" | "funil", member: string | null = null) {
  return <MemoryRouter><TabVisaoGeralV2 section={section} period="month" month={9} year={2026}
    range={range} monthlyRange={range} isAdmin onAskOraculo={vi.fn()} filterMemberId={member} /></MemoryRouter>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.command.mockImplementation((_range, member) => ({
    data: { ...base, reunioesMarcadas: member === "seller" ? 12 : member === "zero" ? 0 : 89 },
    isLoading: false, isError: false, refetch: vi.fn(),
  }));
});
describe("mesma fonte, janela e escopo para reuniões", () => {
  it("Milennials mostra 89 eventos tanto no KPI quanto no funil, não a coorte61", () => {
    const { rerender } = render(overview("kpis"));
    expect(screen.getByRole("button", { name: /Reuniões marcadas: 89/ })).toBeInTheDocument();
    rerender(overview("funil"));
    expect(screen.getByText("89")).toBeInTheDocument();
    expect(screen.getByText("Equipe · atividade no período")).toBeInTheDocument();
    expect(screen.queryByText("61")).not.toBeInTheDocument();
    expect(mocks.cohort).not.toHaveBeenCalled();
  });
  it("troca pessoa sem trocar a janela; zero não vira total da equipe", () => {
    const { rerender } = render(overview("funil", "seller"));
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Pessoa selecionada · atividade no período")).toBeInTheDocument();
    expect(mocks.command).toHaveBeenCalledWith({ start: range.start, end: range.end }, "seller");
    expect(mocks.command).toHaveBeenCalledWith({ start: range.prevStart, end: range.prevEnd }, "seller");
    rerender(overview("funil", "zero"));
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("89")).not.toBeInTheDocument();
  });
  it("meta de marcadas continua mensal e da equipe, pelo ledger", () => {
    const week = { ...range, start: new Date("2026-09-21T00:00:00-03:00") };
    render(<MemoryRouter><TabPerformanceV2 section="metas-equipe" month={9} year={2026} range={week} monthlyRange={range} /></MemoryRouter>);
    expect(screen.getByText("Equipe · metas do mês")).toBeInTheDocument();
    expect(screen.getByText("89 / 100 marcadas no mês · equipe")).toBeInTheDocument();
    expect(mocks.command).toHaveBeenCalledWith({ start: range.start, end: range.end }, null);
    expect(mocks.cohort).not.toHaveBeenCalled();
  });
  it("período sem novos leads preserva atividade em leads antigos sem fabricar proporções", () => {
    mocks.command.mockReturnValue({
      data: { ...base, totalLeads: 0 }, isLoading: false, isError: false, refetch: vi.fn(),
    });
    render(overview("funil"));
    expect(screen.getByText("89")).toBeInTheDocument();
    expect(screen.getByText("vendas / leads —")).toBeInTheDocument();
    expect(screen.queryByText("Sem dados no período")).not.toBeInTheDocument();
  });
});
