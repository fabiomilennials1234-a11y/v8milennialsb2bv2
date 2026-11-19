/**
 * Hover com intenção na linha de conversa — a MESMA composição da
 * `ConversationList`: `LinhaComIntencao` (150 ms, nada em toque) +
 * `useUmPrefetchPorVez` (um prefetch em voo para a lista inteira).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTENCAO_DE_PREFETCH_MS, useUmPrefetchPorVez } from "@/modules/communication/hooks/chat/useUmPrefetchPorVez";
import { LinhaComIntencao } from "@/modules/communication/components/chat/list/LinhaComIntencao";

function Linhas({ prefetch }: { prefetch: (id: string) => Promise<unknown> | void }) {
  const preCarregar = useUmPrefetchPorVez(prefetch);
  return (
    <>
      {["a", "b"].map((id) => (
        <LinhaComIntencao key={id} aoIntencionar={() => preCarregar(id)}>
          <span data-testid={`linha-${id}`} />
        </LinhaComIntencao>
      ))}
    </>
  );
}

const linha = (id: string) => screen.getByTestId(`linha-${id}`).parentElement!;
const entrar = (id: string) => fireEvent.mouseEnter(linha(id));
const sair = (id: string) => fireEvent.mouseLeave(linha(id));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("intenção na linha de conversa", () => {
  it("só pré-carrega depois de 150 ms parado sobre a linha", async () => {
    const prefetch = vi.fn();
    render(<Linhas prefetch={prefetch} />);
    entrar("a");
    await act(async () => { await vi.advanceTimersByTimeAsync(INTENCAO_DE_PREFETCH_MS - 1); });
    expect(prefetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(prefetch).toHaveBeenCalledWith("a");
  });

  it("mouse atravessando a lista (sai antes da intenção) não pré-carrega nada", async () => {
    const prefetch = vi.fn();
    render(<Linhas prefetch={prefetch} />);
    entrar("a");
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    sair("a");
    entrar("b");
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    sair("b");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("toque não pré-carrega (nem o mouseenter que o navegador sintetiza depois dele)", async () => {
    const prefetch = vi.fn();
    render(<Linhas prefetch={prefetch} />);
    fireEvent.touchStart(linha("a"));
    entrar("a");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("foco de teclado também é intenção", async () => {
    const prefetch = vi.fn();
    render(<Linhas prefetch={prefetch} />);
    fireEvent.focus(linha("b"));
    await act(async () => { await vi.advanceTimersByTimeAsync(INTENCAO_DE_PREFETCH_MS); });
    expect(prefetch).toHaveBeenCalledWith("b");
  });

  it("um em voo: a intenção que chega com outro prefetch pendente é descartada", async () => {
    let terminar!: () => void;
    const prefetch = vi.fn(() => new Promise<void>((r) => { terminar = r; }));
    render(<Linhas prefetch={prefetch} />);
    entrar("a");
    await act(async () => { await vi.advanceTimersByTimeAsync(INTENCAO_DE_PREFETCH_MS); });
    sair("a");
    entrar("b");
    await act(async () => { await vi.advanceTimersByTimeAsync(INTENCAO_DE_PREFETCH_MS); });
    expect(prefetch).toHaveBeenCalledTimes(1);
    await act(async () => { terminar(); await vi.advanceTimersByTimeAsync(0); });
    sair("b");
    entrar("b");
    await act(async () => { await vi.advanceTimersByTimeAsync(INTENCAO_DE_PREFETCH_MS); });
    expect(prefetch).toHaveBeenLastCalledWith("b");
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("prefetch que falha não vira erro na tela e libera o próximo", async () => {
    const prefetch = vi.fn().mockRejectedValueOnce(new Error("rede")).mockResolvedValue(undefined);
    render(<Linhas prefetch={prefetch} />);
    entrar("a");
    await act(async () => { await vi.advanceTimersByTimeAsync(INTENCAO_DE_PREFETCH_MS); });
    sair("a");
    entrar("b");
    await act(async () => { await vi.advanceTimersByTimeAsync(INTENCAO_DE_PREFETCH_MS); });
    expect(prefetch).toHaveBeenCalledTimes(2);
  });
});
