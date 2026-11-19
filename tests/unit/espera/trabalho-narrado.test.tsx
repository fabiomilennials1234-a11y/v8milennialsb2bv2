import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TrabalhoNarrado, estimarRestanteMs, type TrabalhoNarradoProps } from "@/shared/espera";

const fases = [
  { id: "buscar", rotulo: "Buscar no mapa" },
  { id: "ler", rotulo: "Ler os sites" },
  { id: "whats", rotulo: "Achar WhatsApp" },
  { id: "salvar", rotulo: "Salvar na lista" },
] as const;

function montar(p: Partial<TrabalhoNarradoProps> = {}) {
  return render(
    <TrabalhoNarrado
      titulo="Prospectador · Padarias em Curitiba"
      fases={fases}
      progresso={{ faseAtual: "ler", feitos: 37, total: 120, itemAtual: "Lendo site: Padaria São Jorge", estimativaMs: 83_000 }}
      estado="rodando"
      {...p}
    />,
  );
}

describe("estimarRestanteMs", () => {
  afterEach(() => vi.useRealTimers());

  it("projeta o restante pelo ritmo até aqui", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    // 10 feitos em 5 s → 0,5 s cada → 30 restantes = 15 s
    expect(estimarRestanteMs(5_000, 10, 40)).toBe(15_000);
  });

  it("sem ritmo ainda (0 feitos) ou total inválido → null", () => {
    expect(estimarRestanteMs(Date.now(), 0, 40)).toBeNull();
    expect(estimarRestanteMs(Date.now(), 5, 0)).toBeNull();
  });

  it("concluído → 0", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    expect(estimarRestanteMs(5_000, 40, 40)).toBe(0);
  });
});

describe("<TrabalhoNarrado>", () => {
  it("mostra X de Y, fase atual, item atual e estimativa", () => {
    montar();
    expect(screen.getByText("37")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveTextContent(/37\s*de 120 · ler os sites · ~2 min/);
    expect(screen.getByText("Lendo site: Padaria São Jorge")).toBeInTheDocument();
    expect(screen.getByText(/~2 min/)).toBeInTheDocument();
    const atual = screen.getByText("Ler os sites").closest("[data-fase]");
    expect(atual).toHaveAttribute("data-fase", "atual");
    expect(screen.getByText("Buscar no mapa").closest("[data-fase]")).toHaveAttribute("data-fase", "feita");
    expect(screen.getByText("Salvar na lista").closest("[data-fase]")).toHaveAttribute("data-fase", "pendente");
    // progresso acessível
    const barra = screen.getByRole("progressbar");
    expect(barra).toHaveAttribute("aria-valuenow", "37");
    expect(barra).toHaveAttribute("aria-valuemax", "120");
  });

  it("estimativa curta em segundos", () => {
    montar({ progresso: { faseAtual: "salvar", feitos: 110, total: 120, estimativaMs: 9_000 } });
    expect(screen.getByText(/~9 s/)).toBeInTheDocument();
  });

  it("Parar chama onParar", () => {
    const onParar = vi.fn();
    montar({ onParar });
    fireEvent.click(screen.getByRole("button", { name: "Parar" }));
    expect(onParar).toHaveBeenCalledTimes(1);
  });

  it("estado parando: botão desabilitado e diz que está parando", () => {
    montar({ onParar: vi.fn(), estado: "parando" });
    const b = screen.getByRole("button", { name: /Parando/ });
    expect(b).toBeDisabled();
  });

  it("sem onParar, sem botão Parar", () => {
    montar();
    expect(screen.queryByRole("button", { name: /Parar/ })).toBeNull();
  });

  it("Continuar em segundo plano só quando há para onde ir", () => {
    const onSegundoPlano = vi.fn();
    const { rerender } = montar();
    expect(screen.queryByRole("button", { name: "Continuar em segundo plano" })).toBeNull();
    rerender(
      <TrabalhoNarrado
        titulo="t"
        fases={fases}
        progresso={{ faseAtual: "ler", feitos: 1, total: 2 }}
        estado="rodando"
        onSegundoPlano={onSegundoPlano}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continuar em segundo plano" }));
    expect(onSegundoPlano).toHaveBeenCalled();
  });

  it("falhou mostra o erro; terminado não oferece Parar", () => {
    montar({ estado: "falhou", erro: "O mapa não respondeu.", onParar: vi.fn() });
    expect(screen.getByRole("alert")).toHaveTextContent("O mapa não respondeu.");
    expect(screen.queryByRole("button", { name: /Parar/ })).toBeNull();
  });

  it("concluído marca todas as fases como feitas", () => {
    montar({ estado: "concluido", progresso: { faseAtual: "salvar", feitos: 120, total: 120 } });
    for (const f of fases) {
      expect(screen.getByText(f.rotulo).closest("[data-fase]")).toHaveAttribute("data-fase", "feita");
    }
  });
});
