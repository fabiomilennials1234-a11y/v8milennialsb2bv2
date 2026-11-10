import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __reiniciarEfeitosDoCard,
  anteciparDestaque,
  cancelarEfeitoDeDesfecho,
  concluirDestaque,
  concluirEfeito,
  definirPainelAberto,
  destacarCard,
  DESTAQUE_ANTECIPACAO_MS,
  DESTAQUE_MS,
  DESTAQUE_SAIDA_MS,
  DESTAQUE_TOTAL_MS,
  dispararEfeitoDeDesfecho,
  encerrarDestaque,
  opacidadeDaOnda,
  prepararDissolucao,
  useDestaqueDoCard,
  useEfeitoDeDesfecho,
  useEntradasEmDesfecho,
  useFantasmas,
} from "./card-effects";
import { CardOutcomeBurst } from "../components/leads/card/CardOutcomeBurst";

function reduzido(ligado: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: ligado }) as never;
}

function cardNaTela(entryId: string, rect = { top: 100, left: 50, width: 260, height: 140 }) {
  const el = document.createElement("div");
  el.setAttribute("data-lead-id", entryId);
  el.className = "kanban-card";
  el.innerHTML = `<span id="interno">Juliana</span>`;
  el.getBoundingClientRect = () =>
    ({ ...rect, bottom: rect.top + rect.height, right: rect.left + rect.width, x: rect.left, y: rect.top }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
  reduzido(false);
  __reiniciarEfeitosDoCard();
});

afterEach(() => {
  __reiniciarEfeitosDoCard();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("ganho e perda", () => {
  it("fora do painel, o card recebe o efeito na hora", () => {
    const { result } = renderHook(() => useEfeitoDeDesfecho("e-1"));
    act(() => dispararEfeitoDeDesfecho("e-1", "won"));
    expect(result.current?.efeito).toBe("won");
  });

  it("com o painel aberto, o efeito espera o painel fechar e o diálogo sair", () => {
    const { result } = renderHook(() => useEfeitoDeDesfecho("e-1"));
    act(() => {
      definirPainelAberto(true);
      dispararEfeitoDeDesfecho("e-1", "lost");
    });
    expect(result.current).toBeNull();

    act(() => definirPainelAberto(false));
    // Ainda na animação de saída do diálogo.
    expect(result.current).toBeNull();

    act(() => vi.advanceTimersByTime(220));
    expect(result.current?.efeito).toBe("lost");
  });

  it("reabrir o negócio antes de fechar o painel cancela o efeito", () => {
    const { result } = renderHook(() => useEfeitoDeDesfecho("e-1"));
    act(() => {
      definirPainelAberto(true);
      dispararEfeitoDeDesfecho("e-1", "won");
      cancelarEfeitoDeDesfecho("e-1");
      definirPainelAberto(false);
      vi.advanceTimersByTime(220);
    });
    expect(result.current).toBeNull();
  });

  it("só afeta o card da entrada: os outros não re-renderizam com efeito", () => {
    const { result } = renderHook(() => useEfeitoDeDesfecho("e-2"));
    act(() => dispararEfeitoDeDesfecho("e-1", "won"));
    expect(result.current).toBeNull();
  });

  it("o fim de um efeito antigo não apaga um mais novo do mesmo card", () => {
    const { result } = renderHook(() => useEfeitoDeDesfecho("e-1"));
    act(() => dispararEfeitoDeDesfecho("e-1", "won"));
    const antigo = result.current!.id;
    act(() => dispararEfeitoDeDesfecho("e-1", "lost"));
    act(() => concluirEfeito("e-1", antigo));
    expect(result.current?.efeito).toBe("lost");
  });

  it("efeito que nenhum card consumiu expira — não toca num board aberto depois", () => {
    act(() => dispararEfeitoDeDesfecho("e-1", "won"));
    act(() => vi.advanceTimersByTime(4000));
    const { result } = renderHook(() => useEfeitoDeDesfecho("e-1"));
    expect(result.current).toBeNull();
  });

  it("com movimento reduzido, nada anima", () => {
    reduzido(true);
    const { result } = renderHook(() => useEfeitoDeDesfecho("e-1"));
    act(() => dispararEfeitoDeDesfecho("e-1", "won"));
    expect(result.current).toBeNull();
  });

  it("o card mostra a camada verde; sem WebGL cai no brilho em CSS", () => {
    render(<CardOutcomeBurst entryId="e-1" />);
    expect(screen.queryByTestId("card-efeito-won")).toBeNull();
    act(() => dispararEfeitoDeDesfecho("e-1", "won"));
    const camada = screen.getByTestId("card-efeito-won");
    expect(camada).toHaveClass("pointer-events-none");
    expect(camada.querySelector("canvas")).toBeNull();
  });
});

describe("entradas em desfecho (o board as mantém soltas)", () => {
  it("lista a entrada do disparo até o efeito acabar — inclusive segurado pelo painel", () => {
    const { result } = renderHook(() => useEntradasEmDesfecho());
    expect(result.current.size).toBe(0);

    act(() => definirPainelAberto(true));
    act(() => dispararEfeitoDeDesfecho("e-1", "won"));
    expect([...result.current]).toEqual(["e-1"]);

    act(() => definirPainelAberto(false));
    act(() => vi.advanceTimersByTime(220 + 4000));
    expect(result.current.size).toBe(0);
  });

  it("devolve o mesmo conjunto enquanto nada muda (snapshot estável)", () => {
    act(() => dispararEfeitoDeDesfecho("e-1", "lost"));
    const { result, rerender } = renderHook(() => useEntradasEmDesfecho());
    const primeiro = result.current;
    rerender();
    expect(result.current).toBe(primeiro);
  });

  it("com movimento reduzido não há efeito: a entrada vai direto para a pilha", () => {
    reduzido(true);
    const { result } = renderHook(() => useEntradasEmDesfecho());
    act(() => dispararEfeitoDeDesfecho("e-1", "won"));
    expect(result.current.size).toBe(0);
  });
});

describe("a curva da onda", () => {
  it("entra, segura e sai — e fora do intervalo é invisível", () => {
    expect(opacidadeDaOnda(-0.1)).toBe(0);
    expect(opacidadeDaOnda(0.06)).toBeCloseTo(0.5);
    expect(opacidadeDaOnda(0.4)).toBe(1);
    expect(opacidadeDaOnda(0.81)).toBeCloseTo(0.5);
    expect(opacidadeDaOnda(1)).toBe(0);
  });

  it("o efeito carrega o instante em que ficou visível, não o do disparo", () => {
    const { result } = renderHook(() => useEfeitoDeDesfecho("e-1"));
    act(() => {
      definirPainelAberto(true);
      dispararEfeitoDeDesfecho("e-1", "won");
    });
    const disparo = performance.now();
    act(() => {
      vi.advanceTimersByTime(3000);
      definirPainelAberto(false);
      vi.advanceTimersByTime(220);
    });
    // Liberado ~3,2 s depois do disparo: a onda começa inteira, não no fim.
    expect(result.current!.inicio - disparo).toBeGreaterThanOrEqual(3000);
  });
});

describe("destaque do negócio (Ir para o negócio)", () => {
  it("dura cinco segundos e acaba sozinho, mesmo sem card montado", () => {
    expect(DESTAQUE_MS).toBe(5000);
    const { result } = renderHook(() => useDestaqueDoCard("e-1"));
    act(() => destacarCard("e-1"));
    expect(result.current).not.toBeNull();

    act(() => vi.advanceTimersByTime(DESTAQUE_MS - 1));
    expect(result.current).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it("é informação, não celebração: movimento reduzido não o desliga", () => {
    reduzido(true);
    const { result } = renderHook(() => useDestaqueDoCard("e-1"));
    act(() => destacarCard("e-1"));
    expect(result.current).not.toBeNull();
  });

  it("o painel do negócio não o segura", () => {
    const { result } = renderHook(() => useDestaqueDoCard("e-1"));
    act(() => {
      definirPainelAberto(true);
      destacarCard("e-1");
    });
    expect(result.current).not.toBeNull();
  });

  it("o quadro 0 do CSS fica um instante antes de agora: a borda já começa a pousar", () => {
    const antes = performance.now();
    act(() => destacarCard("e-1"));
    act(() => vi.advanceTimersByTime(1200));
    // Remontou 1,2 s depois: o relógio é o do destaque, não o da montagem.
    const { result } = renderHook(() => useDestaqueDoCard("e-1"));
    expect(result.current!.inicio).toBe(antes - DESTAQUE_ANTECIPACAO_MS);
    expect(performance.now() - result.current!.inicio).toBe(1200 + DESTAQUE_ANTECIPACAO_MS);
  });

  it("a câmera agenda o pouso para o fim do movimento: expira em inicio + linha do tempo", () => {
    const { result } = renderHook(() => useDestaqueDoCard("e-1"));
    const inicio = performance.now() + 700;
    act(() => destacarCard("e-1", { inicio }));
    expect(result.current!.inicio).toBe(inicio);
    act(() => vi.advanceTimersByTime(700 + DESTAQUE_TOTAL_MS - 1));
    expect(result.current).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it("um destaque por vez: destacar outro card apaga o anterior", () => {
    const primeiro = renderHook(() => useDestaqueDoCard("e-1"));
    const segundo = renderHook(() => useDestaqueDoCard("e-2"));
    act(() => destacarCard("e-1"));
    act(() => destacarCard("e-2"));
    expect(primeiro.result.current).toBeNull();
    expect(segundo.result.current).not.toBeNull();
  });

  it("tocar no card é o 'achei': sai em 240 ms", () => {
    const { result } = renderHook(() => useDestaqueDoCard("e-1"));
    act(() => destacarCard("e-1"));
    act(() => encerrarDestaque("e-1"));
    expect(result.current?.saindo).toBe(true);
    act(() => vi.advanceTimersByTime(DESTAQUE_SAIDA_MS - 1));
    expect(result.current).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it("câmera interrompida: o pouso agendado vem para agora — mas não ressuscita o que a pessoa encerrou", () => {
    const { result } = renderHook(() => useDestaqueDoCard("e-1"));
    act(() => destacarCard("e-1", { inicio: performance.now() + 700 }));
    const agendado = result.current!.id;
    act(() => anteciparDestaque("e-1"));
    expect(result.current!.id).not.toBe(agendado);
    expect(result.current!.inicio).toBe(performance.now() - DESTAQUE_ANTECIPACAO_MS);

    // Já começou: não reinicia.
    const emCurso = result.current!.id;
    act(() => vi.advanceTimersByTime(500));
    act(() => anteciparDestaque("e-1"));
    expect(result.current!.id).toBe(emCurso);

    // A pessoa tocou no card (saindo): nada volta.
    act(() => destacarCard("e-1", { inicio: performance.now() + 700 }));
    act(() => encerrarDestaque("e-1"));
    act(() => anteciparDestaque("e-1"));
    expect(result.current?.saindo).toBe(true);
  });

  it("encerrar outro card não mexe no destaque", () => {
    const { result } = renderHook(() => useDestaqueDoCard("e-1"));
    act(() => destacarCard("e-1"));
    act(() => encerrarDestaque("e-2"));
    expect(result.current?.saindo).toBe(false);
  });

  it("destacar de novo recomeça; o fim do destaque antigo não apaga o novo", () => {
    const { result } = renderHook(() => useDestaqueDoCard("e-1"));
    act(() => destacarCard("e-1"));
    const antigo = result.current!.id;
    act(() => vi.advanceTimersByTime(3000));
    act(() => destacarCard("e-1"));
    act(() => concluirDestaque("e-1", antigo));
    expect(result.current).not.toBeNull();
    // O relógio do novo vale cinco segundos inteiros.
    act(() => vi.advanceTimersByTime(DESTAQUE_MS - 1));
    expect(result.current).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it("só o card da entrada brilha", () => {
    const { result } = renderHook(() => useDestaqueDoCard("e-2"));
    act(() => destacarCard("e-1"));
    expect(result.current).toBeNull();
  });

  it("não solta o card da pilha: é coisa do foco do board, não do efeito", () => {
    const { result } = renderHook(() => useEntradasEmDesfecho());
    act(() => destacarCard("e-1"));
    expect(result.current.size).toBe(0);
  });
});

describe("exclusão", () => {
  it("copia o card antes de excluir e o clone vira poeira só quando dá certo", () => {
    const original = cardNaTela("e-1");
    const { result } = renderHook(() => useFantasmas());

    const poeira = prepararDissolucao(["e-1"]);
    expect(result.current).toHaveLength(0);

    act(() => poeira.dissolver());
    expect(result.current).toHaveLength(1);
    const [fantasma] = result.current;
    expect(fantasma.rect).toEqual({ top: 100, left: 50, width: 260, height: 140 });
    // O clone é imagem: sem id duplicado, sem foco, sem marcador de card.
    expect(fantasma.no.hasAttribute("data-lead-id")).toBe(false);
    expect(fantasma.no.querySelector("#interno")).toBeNull();
    expect(fantasma.no.hasAttribute("inert")).toBe(true);
    // O card real some na hora — a poeira não sai de cima de um card inteiro.
    expect(original.style.visibility).toBe("hidden");
  });

  it("o brilho do 'Ir para o negócio' não vai junto para a poeira", () => {
    const original = cardNaTela("e-1");
    const camada = document.createElement("div");
    camada.className = "card-destaque";
    original.appendChild(camada);
    const { result } = renderHook(() => useFantasmas());
    act(() => prepararDissolucao(["e-1"]).dissolver());
    expect(result.current[0].no.querySelector(".card-destaque")).toBeNull();
  });

  it("exclusão que falhou não deixa rastro", () => {
    const original = cardNaTela("e-1");
    const { result } = renderHook(() => useFantasmas());
    prepararDissolucao(["e-1"]);
    expect(result.current).toHaveLength(0);
    expect(original.style.visibility).toBe("");
  });

  it("card que os dados não tiraram da tela volta a aparecer", () => {
    const original = cardNaTela("e-1");
    act(() => prepararDissolucao(["e-1"]).dissolver());
    act(() => vi.advanceTimersByTime(5000));
    expect(original.style.visibility).toBe("");
  });

  it("com o painel aberto, a poeira espera ele fechar", () => {
    cardNaTela("e-1");
    const { result } = renderHook(() => useFantasmas());
    act(() => {
      definirPainelAberto(true);
      prepararDissolucao(["e-1"]).dissolver();
    });
    expect(result.current).toHaveLength(0);
    act(() => {
      definirPainelAberto(false);
      vi.advanceTimersByTime(220);
    });
    expect(result.current).toHaveLength(1);
  });

  it("ignora card fora da tela e entrada sem card", () => {
    cardNaTela("e-1", { top: 5000, left: 0, width: 260, height: 140 });
    const { result } = renderHook(() => useFantasmas());
    act(() => prepararDissolucao(["e-1", "nao-existe"]).dissolver());
    expect(result.current).toHaveLength(0);
  });
});
