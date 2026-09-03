import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OraculoMensagem } from "../../hooks/useOraculoTurno";
import { OraculoConversa } from "./OraculoConversa";

/**
 * A conversa do Oráculo em coluna estreita — a forma que entra no painel da
 * lateral. A tela cheia em `/oraculo` continua existindo com a lista de
 * conversas ao lado; aqui só cabe a conversa.
 */

const perguntar = vi.fn();
const estado = {
  mensagens: [] as OraculoMensagem[],
  pensando: false,
  erro: null as string | null,
  restantesHoje: null as number | null,
  conversaId: null as string | null,
};

vi.mock("../../hooks/useOraculoTurno", () => ({
  useOraculoTurno: () => ({
    ...estado,
    perguntar,
    abrirConversa: vi.fn(),
  }),
}));

beforeEach(() => {
  perguntar.mockClear();
  estado.mensagens = [];
  estado.pensando = false;
  estado.erro = null;
  estado.restantesHoje = null;
});

describe("OraculoConversa", () => {
  it("manda a pergunta que foi digitada", async () => {
    const user = userEvent.setup();
    render(<OraculoConversa />);

    await user.type(
      screen.getByRole("textbox", { name: /pergunta/i }),
      "onde estou perdendo dinheiro",
    );
    await user.click(screen.getByRole("button", { name: "Perguntar" }));

    expect(perguntar).toHaveBeenCalledWith("onde estou perdendo dinheiro");
  });

  it("mostra a procedência da resposta, e não a inventa quando não veio", () => {
    estado.mensagens = [
      {
        id: "1",
        role: "assistant",
        content: "A conversão caiu 12% em Orçamentos.",
        procedencia: ["metricas", "funil"],
      },
      {
        id: "2",
        role: "assistant",
        content: "Não tenho base para responder isso.",
        procedencia: [],
      },
    ] as OraculoMensagem[];

    render(<OraculoConversa />);

    expect(screen.getByText(/Consultei: metricas, funil/)).toBeInTheDocument();
    // Resposta sem consulta não ganha rodapé de procedência inventado.
    expect(screen.getAllByText(/^Consultei:/)).toHaveLength(1);
  });
});
