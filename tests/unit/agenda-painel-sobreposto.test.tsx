/**
 * `AgendaPanel` — a camada que o botão da lateral abre.
 *
 * O ponto da tela, e o que este arquivo protege: a Agenda abre POR CIMA da
 * página em que a pessoa está, **sem escondê-la**. Se algum dia alguém puser
 * um scrim opaco aqui "para ficar igual ao Pitstop", a tela perde a razão de
 * existir e nenhum teste de render pegaria — daí a asserção explícita de que
 * o capturador de clique é transparente e começa depois da lateral.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// A tela em si arrasta as 4 fontes, Supabase e o diálogo de criação — nada
// disso é o que este arquivo prova.
vi.mock("@/modules/engagement/components/agenda/AgendaAtividades", () => ({
  AgendaAtividades: ({ onClose }: { onClose?: () => void }) => (
    <div>
      <p>conteudo da agenda</p>
      {onClose && (
        <button type="button" onClick={onClose}>
          Fechar Atividades
        </button>
      )}
    </div>
  ),
}));

const { AgendaPanel } = await import(
  "@/modules/engagement/components/agenda/AgendaPanel"
);
const { larguraDoPainel } = await import(
  "@/modules/engagement/components/agenda/agenda-helpers"
);

describe("larguraDoPainel", () => {
  // A promessa da tela em uma linha: o que sobra para a página de baixo.
  const faixa = (vw: number, lateral: number) =>
    vw - lateral - larguraDoPainel(vw, lateral);

  it("na tela larga entrega a proporção da referência", () => {
    expect(larguraDoPainel(1600, 248)).toBe(1040); // 65%
    expect(larguraDoPainel(1366, 248)).toBe(888);
  });

  it("para de crescer em telas muito largas", () => {
    expect(larguraDoPainel(2560, 248)).toBe(1280);
  });

  it("NUNCA engole a página de baixo, nem no limite de 768px", () => {
    // 768 é onde a lateral começa a ser montada — o caso mais apertado real.
    for (const vw of [768, 900, 1024, 1280, 1366, 1600, 1920, 2560]) {
      for (const lateral of [64, 248]) {
        expect(faixa(vw, lateral), `${vw}px / lateral ${lateral}px`).toBeGreaterThanOrEqual(72);
      }
    }
  });

  it("a 768px com a lateral aberta é o teto que manda, não os 65%", () => {
    // 65% de 768 = 499, que somado à lateral de 248 estouraria a janela.
    expect(larguraDoPainel(768, 248)).toBe(448);
    expect(faixa(768, 248)).toBe(72);
  });

  it("recolher a lateral devolve a largura ao painel", () => {
    expect(larguraDoPainel(768, 64)).toBeGreaterThan(larguraDoPainel(768, 248));
  });
});

/**
 * O painel atravessa uma fronteira `React.lazy`, e resolver módulo dinâmico é
 * assíncrono. O `findBy*` espera 1s por padrão — suficiente com o arquivo
 * sozinho, apertado demais na suíte inteira em paralelo, onde estes dois
 * testes entraram como INSTÁVEIS no `test:ratchet` (falhavam na varredura,
 * passavam no retry). O teto maior não mascara defeito: o que se espera aqui é
 * carregamento de chunk, não comportamento.
 */
const ESPERA_LAZY = { timeout: 5000 };

const onClose = vi.fn();

beforeEach(() => onClose.mockClear());

function abrir(sidebarWidth = 248) {
  return render(
    <AgendaPanel open onClose={onClose} sidebarWidth={sidebarWidth} />,
  );
}

describe("AgendaPanel", () => {
  it("fechado não renderiza nada", () => {
    render(<AgendaPanel open={false} onClose={onClose} sidebarWidth={248} />);
    expect(screen.queryByLabelText("Atividades")).not.toBeInTheDocument();
  });

  it("aberto mostra a tela dentro de uma camada nomeada", async () => {
    abrir();
    expect(await screen.findByLabelText("Atividades", undefined, ESPERA_LAZY)).toBeInTheDocument();
    expect(screen.getByText("conteudo da agenda")).toBeInTheDocument();
  });

  it("não cobre a tela inteira — é ancorado à direita", async () => {
    abrir();
    const painel = await screen.findByLabelText("Atividades", undefined, ESPERA_LAZY);
    expect(painel.className).toContain("right-0");
    expect(painel.className).not.toContain("inset-0");
  });

  it("o capturador de clique é TRANSPARENTE — a página de baixo continua legível", () => {
    const { container } = abrir();
    const captador = container.querySelector('[aria-hidden="true"]');
    expect(captador).not.toBeNull();
    // Nada de `bg-background/70` nem `backdrop-blur`: escurecer o fundo mataria
    // justamente o que o pedido quer, que é ver a página de baixo.
    expect(captador?.className ?? "").not.toMatch(/bg-|backdrop-blur/);
  });

  it("o capturador começa DEPOIS da lateral, que segue clicável", () => {
    const { container } = abrir(248);
    const captador = container.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(captador?.style.left).toBe("248px");
  });

  it("recolhida, o capturador acompanha a largura menor da lateral", () => {
    const { container } = abrir(64);
    const captador = container.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(captador?.style.left).toBe("64px");
  });

  it("clicar na página de baixo fecha", async () => {
    const user = userEvent.setup();
    const { container } = abrir();
    const captador = container.querySelector<HTMLElement>('[aria-hidden="true"]');
    await user.click(captador!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape fecha", async () => {
    const user = userEvent.setup();
    abrir();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape com o painel fechado não dispara nada", async () => {
    const user = userEvent.setup();
    render(<AgendaPanel open={false} onClose={onClose} sidebarWidth={248} />);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("o botão de fechar da tela chega até o painel", async () => {
    const user = userEvent.setup();
    abrir();
    await user.click(await screen.findByRole("button", { name: "Fechar Atividades" }, ESPERA_LAZY));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sai de cena quando fecha", async () => {
    const { rerender } = abrir();
    await screen.findByLabelText("Atividades", undefined, ESPERA_LAZY);
    rerender(<AgendaPanel open={false} onClose={onClose} sidebarWidth={248} />);
    await waitForElementToBeRemoved(() => screen.queryByLabelText("Atividades"));
  });
});
