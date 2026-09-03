/**
 * "Adicionar produto" — o diálogo, que era a única parte do caminho de produto
 * sem uma linha de cobertura.
 *
 * `deal-card-produtos.test.tsx` cobre a TABELA (a conta, editar, remover). O
 * diálogo que lança o item não tinha teste nenhum, e foi exatamente ali que
 * saíram os três defeitos relatados em 27/08/2026 — "o botão final de adicionar
 * não está funcionando e o scroll do produto também não":
 *
 *   1. **o botão ficava mudo.** Ele só habilita depois que um produto é
 *      ESCOLHIDO; digitar o nome na busca não escolhe. Quem digitava e ia
 *      direto no botão de baixo via um botão que não fazia nada e não dizia
 *      por quê — que é como um botão quebrado se parece;
 *   2. **sem catálogo, o Enter era o único jeito de confirmar** o nome digitado,
 *      e nada na tela dizia isso. Sem o clique, o pai nunca recebia o produto;
 *   3. **no celular o diálogo nascia ATRÁS do painel.** `SheetContent` é
 *      `z-[51]` e o diálogo era `z-50` — invisível, e ainda assim era ele quem
 *      recebia o toque, porque o Radix põe a camada de baixo em
 *      `pointer-events: none`.
 *
 * O que NÃO dá para medir aqui é a roda do mouse: `react-remove-scroll`, que o
 * `Dialog` monta, engole o `wheel` de tudo que está fora do `DialogContent` — e
 * a lista sai por portal para o `body`. jsdom não tem layout nem rolagem, então
 * o que se trava aqui é a CAUSA: o `Popover` precisa ser `modal` (é isso que lhe
 * dá o próprio `RemoveScroll` aninhado) e a lista precisa pintar acima do
 * diálogo. A medição da rolagem em si foi feita em navegador de verdade
 * (`scrollTop` 0 → 600 com a roda).
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// O cmdk rola o item destacado para dentro da lista assim que ela monta, e
// jsdom não implementa `scrollIntoView`. Sem isto o componente estoura antes de
// qualquer asserção — falha do ambiente, não do código.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const lancar = vi.fn().mockResolvedValue("item-1");

vi.mock("@/modules/leads/components/deal-card/useItensDoNegocio", () => ({
  useAdicionarItemDoNegocio: () => ({ mutateAsync: lancar, isPending: false }),
}));

const catalogo = vi.fn();
vi.mock("@/modules/carteira/hooks/useProducts", () => ({
  useProducts: () => catalogo(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdicionarProdutoDialog } from "@/modules/leads/components/deal-card/AdicionarProdutoDialog";

const PRODUTOS = [
  { id: "p1", name: "Progressiva 1L", ticket: 250, is_active: true, organization_id: "o1" },
  { id: "p2", name: "Shampoo 500ml", ticket: 60, is_active: true, organization_id: "o1" },
];

function abrir(over: Partial<React.ComponentProps<typeof AdicionarProdutoDialog>> = {}) {
  return render(
    <AdicionarProdutoDialog
      aberto
      aoFechar={() => {}}
      dealId="deal-1"
      entryId="entry-1"
      itensAtuais={[]}
      {...over}
    />,
  );
}

/** O botão do rodapé, que é o "botão final" do relato. */
const botaoFinal = () =>
  screen
    .getAllByRole("button")
    .find((b) => b.textContent?.trim() === "Adicionar") as HTMLButtonElement;

beforeEach(() => {
  lancar.mockClear();
  catalogo.mockReturnValue({ data: PRODUTOS, isLoading: false, error: null });
});

describe("AdicionarProdutoDialog — o botão final não fica mudo", () => {
  it("sem produto escolhido, DIZ o que falta em vez de só desabilitar", () => {
    abrir();

    expect(botaoFinal().disabled).toBe(true);
    // A frase é o conserto: um botão desabilitado sem explicação é
    // indistinguível de um botão quebrado.
    expect(screen.getByText(/Digitar na busca ainda não escolhe/i)).toBeTruthy();
  });

  it("escolhido o produto, habilita e manda os números PARSEADOS", async () => {
    abrir();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Progressiva 1L"));

    await waitFor(() => expect(botaoFinal().disabled).toBe(false));

    fireEvent.click(botaoFinal());

    await waitFor(() =>
      expect(lancar).toHaveBeenCalledWith({
        dealId: "deal-1",
        productId: "p1",
        nome: "Progressiva 1L",
        // O `ticket` do catálogo chega mascarado como "250,00" e tem de voltar
        // a número — mandar a string faria a RPC receber NULL.
        quantidade: 1,
        precoUnitario: 250,
        descontoPercent: 0,
      }),
    );
  });
});

describe("AdicionarProdutoDialog — org sem catálogo", () => {
  beforeEach(() => catalogo.mockReturnValue({ data: [], isLoading: false, error: null }));

  it("digitar o nome e CLICAR confirma o avulso — o Enter deixou de ser o único caminho", async () => {
    abrir();

    fireEvent.change(screen.getByPlaceholderText(/Digite o nome do produto/i), {
      target: { value: "Progressiva 1L" },
    });
    // Antes do conserto este botão não existia, e o clique no botão final não
    // fazia nada porque nada tinha sido escolhido.
    fireEvent.click(screen.getByTitle("Usar este nome"));

    await waitFor(() => expect(botaoFinal().disabled).toBe(false));

    fireEvent.click(botaoFinal());

    await waitFor(() =>
      expect(lancar).toHaveBeenCalledWith(
        expect.objectContaining({ productId: null, nome: "Progressiva 1L" }),
      ),
    );
  });

  it("o botão do campo não confirma nome vazio", () => {
    abrir();
    expect((screen.getByTitle("Usar este nome") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AdicionarProdutoDialog — ordem de pintura", () => {
  it("sobe acima do SheetContent (z-[51]) no conteúdo E no overlay", () => {
    abrir();

    const conteudo = screen.getByRole("dialog");
    expect(conteudo.className).toContain("z-[60]");

    // O overlay é irmão do conteúdo no mesmo portal: subir só um deles deixa o
    // escurecido atrás da folha, e o conserto vira meio conserto.
    const overlay = document.querySelector<HTMLElement>("[data-radix-dialog-overlay]")
      ?? conteudo.parentElement!.querySelector<HTMLElement>(".fixed.inset-0");
    expect(overlay?.className).toContain("z-[60]");
  });

  it("a lista de produtos pinta ACIMA do diálogo que a abriu", async () => {
    abrir();

    fireEvent.click(screen.getByRole("combobox"));
    await screen.findByText("Progressiva 1L");

    const lista = document.querySelector<HTMLElement>("[cmdk-list]")!;
    const painel = lista.closest<HTMLElement>("[data-radix-popper-content-wrapper] > *")
      ?? (lista.closest("[role='dialog']") as HTMLElement);

    // `z-50` era empate com o diálogo, resolvido pela ordem do DOM. Com o
    // diálogo em `z-[60]`, empate virou derrota: a lista nasceria atrás dele.
    expect(painel.className).toContain("z-[70]");
  });
});

describe("AdicionarProdutoDialog — enquadramento", () => {
  /**
   * jsdom não calcula layout, então este teste NÃO mede largura — ele guarda a
   * CLASSE, que é o que segura a largura. O vazamento em si foi medido em
   * navegador (Vite + Playwright, 1440×900): sem `grid-cols-1` a track do grid
   * persegue a min-content do nome do produto e passa dos 1000px dentro de um
   * painel de 460px, jogando campos, total e rodapé para fora da borda.
   *
   * A guarda existe porque a regressão é SILENCIOSA: quem apagar o token numa
   * refatoração passa por lint, typecheck, build e por todos os outros testes
   * daqui, e o diálogo volta a vazar sem ninguém notar.
   */
  it("trava a coluna do grid, senão o nome longo estica o diálogo inteiro", () => {
    abrir();

    // `grid-cols-1` = `repeat(1, minmax(0,1fr))`: troca o mínimo da track de
    // `auto` para `0` e desliga o automatic minimum size dos filhos. Sem ele a
    // coluna implícita é `auto`, e `max-w-[460px]` segura só a caixa do painel.
    expect(screen.getByRole("dialog").className).toContain("grid-cols-1");
  });

  it("o nome do produto trunca, e o inteiro continua alcançável no title", async () => {
    abrir();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Progressiva 1L"));

    const nome = await screen.findByTitle("Progressiva 1L");
    // `truncate` é o que corta; o `title` é a contrapartida — sem ele o resto
    // do nome não fica em lugar nenhum da tela.
    expect(nome.className).toContain("truncate");
    expect(nome.textContent).toBe("Progressiva 1L");
  });
});
