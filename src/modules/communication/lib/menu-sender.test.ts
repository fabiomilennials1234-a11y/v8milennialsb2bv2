/**
 * Quem envia o menu, e o que cada canal aceita.
 *
 * ⚠️ O ENVIADOR É UM OBJETO, e isso não é estilo. Passar um hook por prop faz a
 * ORDEM DOS HOOKS mudar entre renderizações quando o pai troca de canal — o React
 * quebra com "Rendered more hooks than during the previous render", e nenhum gate
 * de tipo ou de lint pega isso. Já aconteceu neste chat.
 *
 * O shell chama suas mutations INCONDICIONALMENTE e entrega um objeto pronto.
 */
import { describe, expect, it, vi } from "vitest";

import { criarEnviadorOficial, criarEnviadorUazapi } from "./menu-sender";

describe("tipos que cada canal aceita", () => {
  it("o canal oficial aceita botão, lista e link", () => {
    // `cta` — um botão que abre endereço — é da Meta. A Uazapi não o tem.
    expect(criarEnviadorOficial({ instanceId: "i", numero: "5544", aoEnviar: vi.fn() }).tipos)
      .toEqual(["button", "list", "cta"]);
  });

  it("a Uazapi aceita botão e lista, e não link", () => {
    // Mapear `cta` para `button` ali entregaria ao cliente um botão que devolve
    // texto no lugar de um que abre o navegador.
    expect(criarEnviadorUazapi({ instanceId: "i", numero: "5544", aoEnviar: vi.fn() }).tipos)
      .toEqual(["button", "list"]);
  });
});

describe("o que sai para o proxy", () => {
  it("lista leva o rótulo do botão que a abre", async () => {
    const aoEnviar = vi.fn().mockResolvedValue({ message_id: "x" });
    await criarEnviadorOficial({ instanceId: "inst", numero: "5544", aoEnviar }).enviar({
      tipo: "list",
      texto: "Veja os modelos",
      opcoes: [{ title: "Cabo 6mm", description: "Rolo 100m" }],
      rotuloDaLista: "Ver catálogo",
    });

    expect(aoEnviar).toHaveBeenCalledWith("inst", "5544", "list", "Veja os modelos", [
      { title: "Cabo 6mm", description: "Rolo 100m" },
    ], { listButtonLabel: "Ver catálogo", ctaUrl: undefined, footer: undefined });
  });

  it("a descrição das opções NÃO se perde no caminho", async () => {
    // O proxy achatava tudo para título; a lista da Meta tem uma linha de
    // descrição por item, e achatar deixava o cliente com títulos soltos.
    const aoEnviar = vi.fn().mockResolvedValue({ message_id: "x" });
    await criarEnviadorOficial({ instanceId: "i", numero: "n", aoEnviar }).enviar({
      tipo: "list",
      texto: "t",
      opcoes: [{ title: "A", description: "detalhe" }],
      rotuloDaLista: "Abrir",
    });

    expect(aoEnviar.mock.calls[0][4]).toEqual([{ title: "A", description: "detalhe" }]);
  });
});
