/**
 * A "câmera" do "Ir para o negócio": rola o board até a coluna e o corpo da
 * coluna até o card, com a curva `standard` do V5 — nunca `scrollIntoView`, que
 * arrasta junto a página e os ancestrais (o repo já evita isso em `tabs.tsx`).
 *
 * Dois eixos, contêineres próprios: o trilho horizontal do board (com a barra
 * espelho de cima, escrita com o MESMO inteiro a cada quadro — o eco assíncrono
 * do `onScroll` vira no-op) e o corpo de cada coluna, que rola sozinho. Eles são
 * achados subindo pelo DOM a partir do card, ou pelos `data-quadro` do board.
 *
 * Planejar e rodar são separados: quem orquestra agenda o pouso do brilho para
 * o fim do movimento ANTES de a câmera partir. Relógio injetável: o teste
 * controla o tempo.
 */

// ── Curvas ───────────────────────────────────────────────────────────────────

/**
 * `cubic-bezier(x1, y1, x2, y2)` como função do tempo, para usar as curvas
 * nomeadas do V5 (`tailwind.config.ts` → `transitionTimingFunction`) também no
 * movimento feito em JS. Newton-Raphson com recuo para bisseção — a mesma
 * conta do navegador.
 */
export function curvaCubica(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  const y = (s: number) => ((ay * s + by) * s + cy) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

  const resolver = (alvo: number) => {
    let s = alvo;
    for (let i = 0; i < 8; i++) {
      const erro = x(s) - alvo;
      if (Math.abs(erro) < 1e-7) return s;
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= erro / d;
    }
    let baixo = 0;
    let alto = 1;
    s = alvo;
    while (baixo < alto) {
      const atual = x(s);
      if (Math.abs(atual - alvo) < 1e-7) return s;
      if (alvo > atual) baixo = s;
      else alto = s;
      s = (alto + baixo) / 2;
      if (alto - baixo < 1e-7) break;
    }
    return s;
  };

  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return y(resolver(t));
  };
}

/**
 * `standard` do V5 — a única curva nomeada que parte com inclinação zero: a
 * câmera sai do repouso sem tranco, chega ao pico cedo e passa o fim assentando
 * (o espaço onde o brilho pousa). Paridade com o tailwind travada em teste.
 */
export const CURVA_STANDARD = curvaCubica(0.2, 0, 0, 1);

// ── Alvos ────────────────────────────────────────────────────────────────────

interface Caixa {
  left: number;
  width: number;
  top: number;
  height: number;
}

const limitar = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/**
 * `scrollLeft` que centraliza a coluna no trilho do board. Coluna já inteira
 * na tela: fica onde está — a câmera não se mexe à toa.
 */
export function alvoHorizontal(
  trilho: Caixa & { scrollLeft: number; scrollWidth: number; clientWidth: number },
  coluna: Pick<Caixa, "left" | "width">,
): number {
  const inicio = coluna.left - trilho.left;
  if (inicio >= 0 && inicio + coluna.width <= trilho.clientWidth) return trilho.scrollLeft;
  const desejado = trilho.scrollLeft + inicio - (trilho.clientWidth - coluna.width) / 2;
  return Math.round(limitar(desejado, 0, Math.max(0, trilho.scrollWidth - trilho.clientWidth)));
}

/** Folga entre o card e a borda do corpo da coluna. */
const MARGEM_PX = 12;

/**
 * `scrollTop` que mostra o card inteiro no corpo da coluna. Já cabe com folga:
 * não rola (numa coluna de encerrados, rolar esconderia a pilha — contexto).
 */
export function alvoVertical(
  corpo: Caixa & { scrollTop: number; scrollHeight: number; clientHeight: number },
  card: Pick<Caixa, "top" | "height">,
): number {
  const topo = card.top - corpo.top;
  const base = topo + card.height;
  let delta = 0;
  if (topo < MARGEM_PX) delta = topo - MARGEM_PX;
  else if (base > corpo.clientHeight - MARGEM_PX) delta = base - corpo.clientHeight + MARGEM_PX;
  if (delta === 0) return corpo.scrollTop;
  return Math.round(limitar(corpo.scrollTop + delta, 0, Math.max(0, corpo.scrollHeight - corpo.clientHeight)));
}

/** Abaixo disto, o movimento é tremida, não câmera: o eixo fica parado. */
export const MINIMO_HORIZONTAL_PX = 24;
export const MINIMO_VERTICAL_PX = 8;
/** O corpo da coluna desce um instante depois do trilho: a câmera faz curva, não "L". */
export const DEFASAGEM_VERTICAL_MS = 90;

/** Horizontal: 1.000 px ≈ 700 ms (pico ≈ 96 px por quadro a 60 Hz). */
export function duracaoHorizontal(px: number): number {
  if (Math.abs(px) < MINIMO_HORIZONTAL_PX) return 0;
  return Math.round(limitar(300 + Math.abs(px) * 0.4, 380, 760));
}

export function duracaoVertical(px: number): number {
  if (Math.abs(px) < MINIMO_VERTICAL_PX) return 0;
  return Math.round(limitar(260 + Math.abs(px) * 0.35, 320, 640));
}

// ── Contêineres ──────────────────────────────────────────────────────────────

/** O ancestral mais próximo que rola de fato no eixo (transborda e permite). */
export function rolavelMaisProximo(el: HTMLElement, eixo: "x" | "y"): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const estilo = getComputedStyle(n);
    const overflow = eixo === "x" ? estilo.overflowX : estilo.overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    const transborda = eixo === "x" ? n.scrollWidth > n.clientWidth : n.scrollHeight > n.clientHeight;
    if (transborda) return n;
  }
  return null;
}

// ── Relógio ──────────────────────────────────────────────────────────────────

export interface RelogioDaAnimacao {
  agora: () => number;
  raf: (cb: FrameRequestCallback) => number;
  cancelar: (id: number) => void;
}

export const RELOGIO_DO_NAVEGADOR: RelogioDaAnimacao = {
  agora: () => performance.now(),
  raf: (cb) => requestAnimationFrame(cb),
  cancelar: (id) => cancelAnimationFrame(id),
};

// ── Esperar o card ───────────────────────────────────────────────────────────

/** Seletor do card de um negócio NA coluna dele (o DragOverlay fica fora de colunas). */
export function seletorDoCard(stageKey: string, entryId: string): string {
  return `[data-stage="${CSS.escape(stageKey)}"] [data-lead-id="${CSS.escape(entryId)}"]`;
}

/** Quadros seguidos com o card no mesmo lugar para considerar o layout assentado. */
const QUADROS_ESTAVEIS = 2;

/**
 * Onde o card está, no que importa para a câmera: o topo dele DENTRO da coluna
 * e a esquerda da coluna. As colunas entram subindo 20 px (só `y`): as duas
 * medidas não mudam com isso, então a câmera não espera a entrada acabar.
 */
function posicaoRelativa(card: HTMLElement) {
  const coluna = card.closest<HTMLElement>("[data-stage]");
  const r = card.getBoundingClientRect();
  const c = coluna?.getBoundingClientRect();
  return { top: r.top - (c?.top ?? 0), left: c?.left ?? r.left };
}

/**
 * Espera o card aparecer e PARAR de se mexer em relação à coluna (o mês da
 * pilha que abre, uma página que chega acima dele). `null` se o prazo vencer
 * ou o pedido for cancelado.
 */
export function esperarCard(
  seletor: string,
  {
    raiz = document,
    prazoMs = 6000,
    sinal,
    relogio = RELOGIO_DO_NAVEGADOR,
  }: { raiz?: ParentNode; prazoMs?: number; sinal?: AbortSignal; relogio?: RelogioDaAnimacao } = {},
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const limite = relogio.agora() + prazoMs;
    let anterior: { top: number; left: number } | null = null;
    let estaveis = 0;
    const passo = () => {
      if (sinal?.aborted || relogio.agora() > limite) {
        resolve(null);
        return;
      }
      const el = raiz.querySelector<HTMLElement>(seletor);
      if (el) {
        const p = posicaoRelativa(el);
        estaveis = anterior && anterior.top === p.top && anterior.left === p.left ? estaveis + 1 : 0;
        anterior = p;
        if (estaveis >= QUADROS_ESTAVEIS) {
          resolve(el);
          return;
        }
      } else {
        anterior = null;
        estaveis = 0;
      }
      relogio.raf(passo);
    };
    relogio.raf(passo);
  });
}

// ── Planejar e rodar ─────────────────────────────────────────────────────────

interface Eixo {
  el: HTMLElement;
  /** Quem recebe o MESMO valor a cada quadro (a barra espelho do trilho). */
  espelhos: HTMLElement[];
  de: number;
  ate: number;
  /** Atraso a partir do início da câmera. */
  atrasoMs: number;
  duracaoMs: number;
}

export interface PlanoDaCamera {
  horizontal: Eixo | null;
  vertical: Eixo | null;
  /** Do início até a câmera parar (0 = nada a percorrer). */
  duracaoTotalMs: number;
}

/**
 * O que a câmera vai fazer até este card, sem mexer em nada ainda. `barra` é a
 * barra de rolagem espelho de cima do board (`data-quadro="barra-topo"`).
 */
export function planejarCamera(card: HTMLElement, { barra }: { barra?: HTMLElement | null } = {}): PlanoDaCamera {
  const coluna = card.closest<HTMLElement>("[data-stage]") ?? card;
  const trilho = rolavelMaisProximo(coluna, "x");
  const corpo = rolavelMaisProximo(card, "y");

  let horizontal: Eixo | null = null;
  if (trilho) {
    const t = trilho.getBoundingClientRect();
    const c = coluna.getBoundingClientRect();
    const ate = alvoHorizontal(
      { left: t.left, width: t.width, top: t.top, height: t.height, scrollLeft: trilho.scrollLeft, scrollWidth: trilho.scrollWidth, clientWidth: trilho.clientWidth },
      { left: c.left, width: c.width },
    );
    const duracaoMs = duracaoHorizontal(ate - trilho.scrollLeft);
    if (duracaoMs > 0) {
      horizontal = { el: trilho, espelhos: barra ? [barra] : [], de: trilho.scrollLeft, ate, atrasoMs: 0, duracaoMs };
    }
  }

  let vertical: Eixo | null = null;
  if (corpo && corpo !== trilho) {
    const b = corpo.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    const ate = alvoVertical(
      { left: b.left, width: b.width, top: b.top, height: b.height, scrollTop: corpo.scrollTop, scrollHeight: corpo.scrollHeight, clientHeight: corpo.clientHeight },
      { top: r.top, height: r.height },
    );
    const duracaoMs = duracaoVertical(ate - corpo.scrollTop);
    if (duracaoMs > 0) {
      vertical = { el: corpo, espelhos: [], de: corpo.scrollTop, ate, atrasoMs: horizontal ? DEFASAGEM_VERTICAL_MS : 0, duracaoMs };
    }
  }

  const fim = (e: Eixo | null) => (e ? e.atrasoMs + e.duracaoMs : 0);
  return { horizontal, vertical, duracaoTotalMs: Math.max(fim(horizontal), fim(vertical)) };
}

function escrever(eixo: Eixo, horizontal: boolean, valor: number) {
  const v = Math.round(valor);
  for (const el of [eixo.el, ...eixo.espelhos]) {
    if (horizontal) el.scrollLeft = v;
    else el.scrollTop = v;
  }
}

/**
 * Leva os eixos até o destino, guiado pelo TEMPO (um quadro perdido pula à
 * frente, não deixa a câmera lenta). Movimento reduzido: salta direto.
 * Resolve `true` ao chegar; `false` se o `sinal` abortar no meio (a pessoa
 * assumiu a tela — a câmera não briga com ela).
 */
export function rodarCamera(
  plano: PlanoDaCamera,
  {
    reduzido = false,
    sinal,
    relogio = RELOGIO_DO_NAVEGADOR,
  }: { reduzido?: boolean; sinal?: AbortSignal; relogio?: RelogioDaAnimacao } = {},
): Promise<boolean> {
  const { horizontal, vertical } = plano;
  if (sinal?.aborted) return Promise.resolve(false);
  if (reduzido || plano.duracaoTotalMs === 0) {
    if (horizontal) escrever(horizontal, true, horizontal.ate);
    if (vertical) escrever(vertical, false, vertical.ate);
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const inicio = relogio.agora();
    let quadro = 0;
    let encerrado = false;
    const parar = (chegou: boolean) => {
      if (encerrado) return;
      encerrado = true;
      relogio.cancelar(quadro);
      sinal?.removeEventListener("abort", interromper);
      resolve(chegou);
    };
    const interromper = () => parar(false);
    sinal?.addEventListener("abort", interromper, { once: true });

    const mover = (eixo: Eixo | null, ehHorizontal: boolean, decorrido: number) => {
      if (!eixo) return;
      const p = limitar((decorrido - eixo.atrasoMs) / eixo.duracaoMs, 0, 1);
      escrever(eixo, ehHorizontal, eixo.de + (eixo.ate - eixo.de) * CURVA_STANDARD(p));
    };
    const passo = () => {
      // Trava própria: um quadro já agendado não escreve depois do fim.
      if (encerrado) return;
      const decorrido = relogio.agora() - inicio;
      mover(horizontal, true, decorrido);
      mover(vertical, false, decorrido);
      if (decorrido >= plano.duracaoTotalMs) {
        parar(true);
        return;
      }
      quadro = relogio.raf(passo);
    };
    quadro = relogio.raf(passo);
  });
}
