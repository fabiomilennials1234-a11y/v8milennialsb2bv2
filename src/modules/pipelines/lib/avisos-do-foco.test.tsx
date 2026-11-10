import { act, render, renderHook } from "@testing-library/react";
import { Toaster, toast } from "sonner";
import {
  LOCALIZANDO_APOS_MS,
  LOCALIZANDO_TETO_MS,
  toastAviso,
  toastLocalizando,
  useAvisoLocalizando,
} from "./avisos-do-foco";

describe("useAvisoLocalizando", () => {
  let mostrar: ReturnType<typeof vi.spyOn>;
  let dispensar: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    mostrar = vi.spyOn(toast, "loading");
    dispensar = vi.spyOn(toast, "dismiss");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  type P = { nonce: number | null; pausado: boolean; esperando: boolean };
  const montar = (p: P) =>
    renderHook(({ nonce, pausado, esperando }: P) => useAvisoLocalizando(nonce, { pausado, aindaEsperando: () => esperando }), {
      initialProps: p,
    });

  it("decidiu antes de 400 ms: nada aparece", () => {
    montar({ nonce: 1, pausado: false, esperando: false });
    act(() => void vi.advanceTimersByTime(LOCALIZANDO_APOS_MS));
    expect(mostrar).not.toHaveBeenCalled();
  });

  it("busca lenta: aparece aos 400 ms, com o id DESTE pedido", () => {
    montar({ nonce: 7, pausado: false, esperando: true });
    act(() => void vi.advanceTimersByTime(LOCALIZANDO_APOS_MS - 1));
    expect(mostrar).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(mostrar).toHaveBeenCalledWith("Localizando o negócio…", { id: toastLocalizando(7) });
  });

  it("pedido abandonado (saiu da página, outro funil, pedido novo): o spinner sai junto", () => {
    const hook = montar({ nonce: 7, pausado: false, esperando: true });
    act(() => void vi.advanceTimersByTime(LOCALIZANDO_APOS_MS));
    hook.rerender({ nonce: null, pausado: false, esperando: true });
    expect(dispensar).toHaveBeenCalledWith(toastLocalizando(7));

    dispensar.mockClear();
    const outro = montar({ nonce: 8, pausado: false, esperando: true });
    act(() => void vi.advanceTimersByTime(LOCALIZANDO_APOS_MS));
    outro.unmount();
    expect(dispensar).toHaveBeenCalledWith(toastLocalizando(8));
  });

  it("funil que não abre: não aparece; se já aparecia, sai", () => {
    montar({ nonce: 1, pausado: true, esperando: true });
    act(() => void vi.advanceTimersByTime(LOCALIZANDO_APOS_MS));
    expect(mostrar).not.toHaveBeenCalled();

    const hook = montar({ nonce: 2, pausado: false, esperando: true });
    act(() => void vi.advanceTimersByTime(LOCALIZANDO_APOS_MS));
    hook.rerender({ nonce: 2, pausado: true, esperando: true });
    expect(dispensar).toHaveBeenCalledWith(toastLocalizando(2));
  });

  it("teto: sem decisão em 20 s, o spinner sai sozinho", () => {
    montar({ nonce: 3, pausado: false, esperando: true });
    act(() => void vi.advanceTimersByTime(LOCALIZANDO_TETO_MS - 1));
    expect(dispensar).not.toHaveBeenCalledWith(toastLocalizando(3));
    act(() => void vi.advanceTimersByTime(1));
    expect(dispensar).toHaveBeenCalledWith(toastLocalizando(3));
  });
});

// Com o sonner de verdade: o motivo dos ids por papel.
describe("ids por papel no sonner", () => {
  const espera = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
  const vivos = () =>
    [...document.querySelectorAll("[data-sonner-toast]")]
      .filter((li) => li.getAttribute("data-removed") !== "true")
      .map((li) => ({ tipo: li.getAttribute("data-type"), titulo: li.querySelector("[data-title]")?.textContent }));

  afterEach(async () => {
    act(() => void toast.dismiss());
    await espera(300);
  });

  it("o aviso da decisão, com id próprio, não herda o 'loading' e fecha sozinho", async () => {
    render(<Toaster />);
    act(() => void toast.loading("Localizando o negócio…", { id: toastLocalizando(1) }));
    await espera(50);
    act(() => {
      toast.dismiss(toastLocalizando(1));
      toast("Não encontramos este negócio", { id: toastAviso(1), duration: 300 });
    });
    await espera(50);
    expect(vivos().map((t) => t.titulo)).toEqual(["Não encontramos este negócio"]);
    expect(vivos()[0].tipo).not.toBe("loading");
    await espera(900);
    expect(vivos()).toEqual([]);
  });

  it("(o defeito que isso evita) mesmo id: o aviso vira 'loading' e não fecha nunca", async () => {
    render(<Toaster />);
    act(() => void toast.loading("Localizando o negócio…", { id: "mesmo-id" }));
    await espera(50);
    act(() => void toast("Não encontramos este negócio", { id: "mesmo-id", duration: 300 }));
    await espera(900);
    expect(vivos()).toEqual([{ tipo: "loading", titulo: "Não encontramos este negócio" }]);
  });
});
