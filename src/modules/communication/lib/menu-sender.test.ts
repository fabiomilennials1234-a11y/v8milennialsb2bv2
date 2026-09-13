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

describe('UAZAPI composer contract', () => {
  it('preserves label, description and accepted result for local persistence', async () => {
    const result = { message_id: 'real-id', status: 'queued', timestamp: 1789130000 };
    const aoEnviar = vi.fn().mockResolvedValue(result);
    const aoGravar = vi.fn();
    const menu = { tipo: 'list' as const, texto: 'QA', opcoes: [{ title: 'Validar', description: 'Teste' }], rotuloDaLista: 'Abrir QA' };
    await criarEnviadorUazapi({ instanceId: 'i', numero: 'n', aoEnviar, aoGravar }).enviar(menu);
    expect(aoEnviar).toHaveBeenCalledWith('i', 'n', 'list', 'QA', [{ title: 'Validar|Validar|Teste' }], { footer: undefined, listButtonLabel: 'Abrir QA' });
    expect(aoGravar).toHaveBeenCalledWith(menu, 'real-id', result);
  });
  it('does not persist a rejected send', async () => {
    const aoGravar = vi.fn();
    const sender = criarEnviadorUazapi({ instanceId: 'i', numero: 'n', aoEnviar: vi.fn().mockRejectedValue(new Error('timeout')), aoGravar });
    await expect(sender.enviar({ tipo: 'list', texto: 'QA', opcoes: [{ title: 'A' }] })).rejects.toThrow('timeout');
    expect(aoGravar).not.toHaveBeenCalled();
  });
  it('rejects ambiguous list delimiters before sending', async () => {
    const aoEnviar = vi.fn();
    await expect(criarEnviadorUazapi({ instanceId: 'i', numero: 'n', aoEnviar }).enviar({ tipo: 'list', texto: 'QA', opcoes: [{ title: 'A|B', description: 'D' }] })).rejects.toThrow('separadores');
    expect(aoEnviar).not.toHaveBeenCalled();
  });
});
