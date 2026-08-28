/**
 * `proposal/ProductCombobox` dentro de diálogo.
 *
 * A #1862 consertou o combobox de `client/` e o corpo da PR registrou que
 * `NewOrderModal`, `EditOrderDialog` e `CreateProposalModal` pegariam o
 * conserto de carona. **Isso valia só para os dois primeiros.**
 * `CreateProposalModal` importa `./ProductCombobox` — o de `proposal/`, que é
 * outro arquivo e ficou sem o conserto. Junto com ele ficaram `BudgetFieldBlock`
 * (dentro do `DealDetailDialog` e do `CrossPipePanel`) e `PropostasContext`.
 *
 * Os dois defeitos, medidos em navegador antes e depois (bancada com 42
 * produtos, `scrollHeight` 1436 numa caixa de 300):
 *
 *   1. **a lista não rolava.** O `Dialog` monta um `react-remove-scroll` que
 *      engole o `wheel` de tudo fora do `DialogContent`, e o conteúdo do
 *      Popover sai por portal para o `body`. Sem `modal`, `scrollTop` ficava em
 *      0 depois da roda; com `modal`, foi a 600;
 *   2. **no celular a lista nascia ATRÁS da folha.** `SheetContent` é `z-[51]`
 *      e o `PopoverContent` do primitivo é `z-50`. A lista existia no DOM, com
 *      retângulo e `visibility: visible`, e mesmo assim não pintava.
 *
 * ⚠️ `elementsFromPoint` afirmou "lista no topo" nos DOIS casos — inclusive no
 * quebrado. Quem desempatou foi a captura de tela. Não confie em hit-test para
 * decidir empilhamento de conteúdo portalizado.
 *
 * jsdom não tem layout nem rolagem, então aqui se trava a CAUSA de cada um.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// O cmdk rola o item destacado para dentro da lista assim que ela monta, e
// jsdom não implementa `scrollIntoView`.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProductCombobox } from "@/modules/carteira/components/proposal/ProductCombobox";

const PRODUTOS = [
  { id: "p1", name: "Progressiva 1L", sku: "SKU-1", type: "unitario" },
  { id: "p2", name: "Shampoo 500ml", sku: "SKU-2", type: "unitario" },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any[];

/** Mesmo arranjo de `CreateProposalModal`: o combobox DENTRO do diálogo. */
function abrir() {
  return render(
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <ProductCombobox products={PRODUTOS} value="" onSelect={() => {}} />
      </DialogContent>
    </Dialog>,
  );
}

describe("proposal/ProductCombobox dentro de diálogo", () => {
  it("a lista pinta ACIMA da superfície que a abriu", async () => {
    abrir();

    fireEvent.click(screen.getByRole("combobox"));
    await screen.findByText("Progressiva 1L");

    const lista = document.querySelector<HTMLElement>("[cmdk-list]")!;
    const painel = lista.closest<HTMLElement>(
      "[data-radix-popper-content-wrapper] > *",
    )!;

    // `z-50` perde do `SheetContent` (`z-[51]`), que é o que o
    // `DealDetailDialog` vira abaixo de 768px.
    expect(painel.className).toContain("z-[70]");
  });

  it("o Popover é `modal` — que é o que devolve a roda do mouse à lista", async () => {
    abrir();

    fireEvent.click(screen.getByRole("combobox"));
    await screen.findByText("Progressiva 1L");

    /*
     * Observável de `modal`: o Radix chama `hideOthers` a partir do conteúdo do
     * Popover, e o diálogo — que é IRMÃO dele no `body`, não ancestral — leva
     * `aria-hidden`. Sem `modal` esse `hideOthers` não roda e o diálogo fica
     * sem o atributo.
     *
     * Medido por mutação nos dois sentidos: com `modal` o diálogo vem
     * `aria-hidden="true"`; tirando o `modal`, vem sem atributo nenhum.
     */
    const dialogo = document.querySelector<HTMLElement>("[role='dialog']")!;
    expect(dialogo.getAttribute("aria-hidden")).toBe("true");
  });
});
