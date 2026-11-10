import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  alvoHorizontal,
  alvoVertical,
  CURVA_STANDARD,
  curvaCubica,
  DEFASAGEM_VERTICAL_MS,
  duracaoHorizontal,
  duracaoVertical,
  esperarCard,
  planejarCamera,
  rodarCamera,
  rolavelMaisProximo,
  seletorDoCard,
} from "./rolar-ate-o-card";

/** Relógio manual: cada `avancar` roda os quadros pendentes. */
function relogioManual() {
  let t = 0;
  let fila: FrameRequestCallback[] = [];
  return {
    agora: () => t,
    raf: (cb: FrameRequestCallback) => {
      fila.push(cb);
      return fila.length;
    },
    cancelar: () => {},
    avancar(ms: number) {
      t += ms;
      const rodar = fila;
      fila = [];
      for (const cb of rodar) cb(t);
    },
  };
}

function comCaixa<T extends HTMLElement>(el: T, r: { left?: number; top?: number; width?: number; height?: number }) {
  const caixa = { left: 0, top: 0, width: 0, height: 0, ...r };
  el.getBoundingClientRect = () =>
    ({ ...caixa, right: caixa.left + caixa.width, bottom: caixa.top + caixa.height, x: caixa.left, y: caixa.top, toJSON: () => caixa }) as DOMRect;
  return el;
}

function comRolagem<T extends HTMLElement>(el: T, d: { sw?: number; cw?: number; sh?: number; ch?: number }) {
  Object.defineProperty(el, "scrollWidth", { value: d.sw ?? 0, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: d.cw ?? 0, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: d.sh ?? 0, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: d.ch ?? 0, configurable: true });
  return el;
}

describe("curvaCubica (as curvas nomeadas do V5, fora do CSS)", () => {
  it("começa em 0, termina em 1 e nunca volta", () => {
    let anterior = 0;
    for (let i = 1; i <= 100; i++) {
      const y = CURVA_STANDARD(i / 100);
      expect(y).toBeGreaterThanOrEqual(anterior);
      anterior = y;
    }
    expect(CURVA_STANDARD(0)).toBe(0);
    expect(CURVA_STANDARD(1)).toBe(1);
  });

  it("bate com o CSS: ease-in-out simétrica passa no meio; `ease` em 0,5 ≈ 0,8024", () => {
    expect(curvaCubica(0.42, 0, 0.58, 1)(0.5)).toBeCloseTo(0.5, 5);
    expect(curvaCubica(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
  });

  it("a câmera usa a `standard` do tailwind — se o token mudar, o teste avisa", () => {
    const config = readFileSync(resolve(__dirname, "../../../../tailwind.config.ts"), "utf8");
    const token = config.match(/\bstandard:\s*'(cubic-bezier\([^)]*\))'/)?.[1];
    expect(token).toBe("cubic-bezier(0.2, 0, 0, 1)");
    const [x1, y1, x2, y2] = token!.match(/[\d.]+/g)!.map(Number);
    const doToken = curvaCubica(x1, y1, x2, y2);
    for (const t of [0.1, 0.3, 0.5, 0.8]) expect(CURVA_STANDARD(t)).toBeCloseTo(doToken(t), 6);
  });
});

const caixa = (left: number, width: number, top = 0, height = 500) => ({ left, width, top, height });

describe("alvoHorizontal", () => {
  // Board de 1.000 px visíveis rolando um trilho de 3.000 px.
  const board = { scrollLeft: 0, scrollWidth: 3000, clientWidth: 1000, ...caixa(100, 1000) };

  it("centraliza a coluna que está fora da tela", () => {
    expect(alvoHorizontal(board, caixa(1900, 300))).toBe(1800 - 350);
  });

  it("coluna já inteira na tela: a câmera não se mexe à toa", () => {
    expect(alvoHorizontal(board, caixa(400, 300))).toBe(0);
  });

  it("não passa do fim nem do começo do trilho", () => {
    expect(alvoHorizontal({ ...board, scrollLeft: 1500 }, caixa(-1400, 300))).toBe(0);
    expect(alvoHorizontal(board, caixa(3000, 300))).toBe(2000);
  });
});

describe("alvoVertical", () => {
  const corpo = { scrollTop: 600, scrollHeight: 4000, clientHeight: 500, ...caixa(0, 280, 200, 500) };

  it("card abaixo do visível: rola só o necessário para ele caber inteiro", () => {
    // base do card a 1.020 px do topo do corpo; cabe com 12 px de folga em 500.
    expect(alvoVertical(corpo, caixa(0, 260, 1100, 120))).toBe(600 + (1100 - 200 + 120) - 500 + 12);
  });

  it("card já inteiro com folga: não rola (numa coluna de encerrados, preserva a pilha)", () => {
    expect(alvoVertical(corpo, caixa(0, 260, 300, 120))).toBe(600);
  });

  it("card acima do visível sobe até ele, sem passar do topo", () => {
    expect(alvoVertical(corpo, caixa(0, 260, 50, 120))).toBe(600 - 150 - 12);
    expect(alvoVertical({ ...corpo, scrollTop: 0 }, caixa(0, 260, 150, 120))).toBe(0);
  });
});

describe("durações", () => {
  it("horizontal: 1.000 px ≈ 700 ms, com piso e teto; micro-delta não anima", () => {
    expect(duracaoHorizontal(1000)).toBe(700);
    expect(duracaoHorizontal(100)).toBe(380);
    expect(duracaoHorizontal(5000)).toBe(760);
    expect(duracaoHorizontal(-1000)).toBe(700);
    expect(duracaoHorizontal(23)).toBe(0);
  });

  it("vertical: mais curta, também com piso, teto e limiar", () => {
    expect(duracaoVertical(400)).toBe(400);
    expect(duracaoVertical(20)).toBe(320);
    expect(duracaoVertical(9000)).toBe(640);
    expect(duracaoVertical(7)).toBe(0);
  });
});

describe("rolavelMaisProximo", () => {
  function no(estilo: Partial<CSSStyleDeclaration>, dims: { sw?: number; cw?: number; sh?: number; ch?: number } = {}) {
    const el = comRolagem(document.createElement("div"), dims);
    Object.assign(el.style, estilo);
    return el;
  }

  it("acha o corpo da coluna (vertical) e o trilho do board (horizontal)", () => {
    const trilho = no({ overflowX: "auto" }, { sw: 3000, cw: 1000 });
    const corpo = no({ overflowY: "auto" }, { sh: 4000, ch: 500 });
    const card = document.createElement("div");
    corpo.appendChild(card);
    trilho.appendChild(corpo);
    document.body.appendChild(trilho);
    expect(rolavelMaisProximo(card, "y")).toBe(corpo);
    expect(rolavelMaisProximo(card, "x")).toBe(trilho);
    trilho.remove();
  });

  it("contêiner que não transborda não conta (nada para rolar)", () => {
    const trilho = no({ overflowX: "auto" }, { sw: 1000, cw: 1000 });
    const card = document.createElement("div");
    trilho.appendChild(card);
    document.body.appendChild(trilho);
    expect(rolavelMaisProximo(card, "x")).toBeNull();
    trilho.remove();
  });
});

describe("seletorDoCard", () => {
  it("mira o card DENTRO da coluna (o clone do arrasto fica fora de colunas)", () => {
    document.body.innerHTML = `
      <div data-stage="novo"><div data-lead-id="e-1" id="na-coluna"></div></div>
      <div id="overlay"><div data-lead-id="e-1"></div></div>`;
    expect(document.querySelector(seletorDoCard("novo", "e-1"))?.id).toBe("na-coluna");
    expect(document.querySelector(seletorDoCard("vendido", "e-1"))).toBeNull();
    document.body.innerHTML = "";
  });
});

describe("esperarCard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function cardNaColuna() {
    const coluna = document.createElement("div");
    coluna.setAttribute("data-stage", "novo");
    const card = document.createElement("div");
    card.setAttribute("data-lead-id", "e-1");
    coluna.appendChild(card);
    document.body.appendChild(coluna);
    return { coluna, card };
  }

  it("a entrada das colunas (só `y`) não atrasa a câmera: mede o card DENTRO da coluna", async () => {
    const r = relogioManual();
    const { coluna, card } = cardNaColuna();
    let achado: HTMLElement | null | undefined;
    void esperarCard('[data-lead-id="e-1"]', { relogio: r }).then((el) => (achado = el));
    // A coluna sobe 20 → 0 px; o card sobe junto.
    for (const y of [20, 14, 8]) {
      comCaixa(coluna, { left: 300, top: 100 + y });
      comCaixa(card, { left: 310, top: 140 + y });
      r.avancar(16);
    }
    await Promise.resolve();
    expect(achado).toBe(card);
  });

  it("espera o card PARAR em relação à coluna (o mês da pilha que abre por cima)", async () => {
    const r = relogioManual();
    const { coluna, card } = cardNaColuna();
    comCaixa(coluna, { left: 300, top: 100 });
    let achado: HTMLElement | null | undefined;
    void esperarCard('[data-lead-id="e-1"]', { relogio: r }).then((el) => (achado = el));
    for (const top of [300, 260, 230]) {
      comCaixa(card, { left: 310, top });
      r.avancar(16);
    }
    await Promise.resolve();
    expect(achado).toBeUndefined();
    r.avancar(16);
    r.avancar(16);
    await Promise.resolve();
    expect(achado).toBe(card);
  });

  it("desiste no prazo — o board pode nunca mostrar o card", async () => {
    const r = relogioManual();
    const feito = esperarCard('[data-lead-id="nao-existe"]', { relogio: r, prazoMs: 100 });
    for (let i = 0; i < 10; i++) r.avancar(16);
    expect(await feito).toBeNull();
  });

  it("cancelado (a pessoa saiu da página), resolve null", async () => {
    const r = relogioManual();
    const ctrl = new AbortController();
    const feito = esperarCard('[data-lead-id="x"]', { relogio: r, sinal: ctrl.signal });
    ctrl.abort();
    r.avancar(16);
    expect(await feito).toBeNull();
  });
});

describe("planejarCamera + rodarCamera", () => {
  function montarBoard({ cardTop = 1100 } = {}) {
    const barra = document.createElement("div");
    barra.setAttribute("data-quadro", "barra-topo");
    const trilho = comCaixa(comRolagem(document.createElement("div"), { sw: 3000, cw: 1000 }), { left: 100, width: 1000, top: 150, height: 600 });
    trilho.style.overflowX = "auto";
    const coluna = comCaixa(document.createElement("div"), { left: 1900, width: 300, top: 150, height: 600 });
    coluna.setAttribute("data-stage", "novo");
    const corpo = comCaixa(comRolagem(document.createElement("div"), { sh: 4000, ch: 500 }), { left: 1900, width: 300, top: 200, height: 500 });
    corpo.style.overflowY = "auto";
    corpo.scrollTop = 600;
    const card = comCaixa(document.createElement("div"), { left: 1910, width: 280, top: cardTop, height: 120 });
    card.setAttribute("data-lead-id", "e-1");
    corpo.appendChild(card);
    coluna.appendChild(corpo);
    trilho.appendChild(coluna);
    document.body.append(barra, trilho);
    return { barra, trilho, corpo, card };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("planeja os dois eixos sem mexer em nada: o pouso do brilho pode ser agendado antes de partir", () => {
    const { trilho, corpo, card, barra } = montarBoard();
    const plano = planejarCamera(card, { barra });
    expect(trilho.scrollLeft).toBe(0);
    expect(corpo.scrollTop).toBe(600);
    expect(plano.horizontal).toMatchObject({ de: 0, ate: 1450, atrasoMs: 0, duracaoMs: duracaoHorizontal(1450) });
    expect(plano.vertical).toMatchObject({ de: 600, ate: 1132, atrasoMs: DEFASAGEM_VERTICAL_MS });
    expect(plano.duracaoTotalMs).toBe(Math.max(duracaoHorizontal(1450), DEFASAGEM_VERTICAL_MS + duracaoVertical(532)));
  });

  it("card que já cabe: a coluna não rola (nada de movimento sem informação)", () => {
    const { card, barra } = montarBoard({ cardTop: 300 });
    expect(planejarCamera(card, { barra }).vertical).toBeNull();
  });

  it("a cada quadro, trilho e barra espelho recebem o MESMO inteiro; assenta no destino", async () => {
    const { trilho, corpo, card, barra } = montarBoard();
    const r = relogioManual();
    const plano = planejarCamera(card, { barra });
    const feito = rodarCamera(plano, { relogio: r });
    for (let t = 0; t <= plano.duracaoTotalMs + 32; t += 16) {
      r.avancar(16);
      expect(barra.scrollLeft).toBe(trilho.scrollLeft);
      expect(Number.isInteger(trilho.scrollLeft)).toBe(true);
    }
    expect(await feito).toBe(true);
    expect(trilho.scrollLeft).toBe(1450);
    expect(corpo.scrollTop).toBe(1132);
  });

  it("o vertical só sai depois da defasagem — a câmera faz curva, não 'L'", () => {
    const { corpo, card, barra } = montarBoard();
    const r = relogioManual();
    void rodarCamera(planejarCamera(card, { barra }), { relogio: r });
    r.avancar(0);
    r.avancar(DEFASAGEM_VERTICAL_MS - 10);
    expect(corpo.scrollTop).toBe(600);
    r.avancar(60);
    expect(corpo.scrollTop).toBeGreaterThan(600);
  });

  it("a pessoa assumiu a tela no meio: a câmera para onde está e avisa", async () => {
    const { trilho, card, barra } = montarBoard();
    const r = relogioManual();
    const ctrl = new AbortController();
    const feito = rodarCamera(planejarCamera(card, { barra }), { relogio: r, sinal: ctrl.signal });
    r.avancar(0);
    r.avancar(120);
    const noMeio = trilho.scrollLeft;
    ctrl.abort();
    r.avancar(200);
    expect(await feito).toBe(false);
    expect(trilho.scrollLeft).toBe(noMeio);
  });

  it("movimento reduzido: salta direto, no mesmo destino", async () => {
    const { trilho, corpo, card, barra } = montarBoard();
    expect(await rodarCamera(planejarCamera(card, { barra }), { reduzido: true })).toBe(true);
    expect(trilho.scrollLeft).toBe(1450);
    expect(barra.scrollLeft).toBe(1450);
    expect(corpo.scrollTop).toBe(1132);
  });
});
