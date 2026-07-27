import { useLayoutEffect, useRef } from "react";

/**
 * fit-to-width do valor de cabeça (#1293, spec finishing §3.3).
 *
 * O número NUNCA reticencia nem quebra linha (já `whitespace-nowrap`), mas em
 * célula estreita (grid_w:2 ≈ 295px @1920) o compacto ainda transborda (Bancada:
 * `over=40`). Ordem de defesa: (1) compacto já feito no formatador; (2) ENCOLHE a
 * fonte até caber; (3) piso de LEGIBILIDADE a 3m = 36px — nunca abaixo. Se nem no
 * piso couber, mantém 36px (não quebra, não reticencia) — aí é célula estreita
 * demais p/ o formato, decisão de composição (P5), não de tipografia.
 *
 * Mede o próprio overflow do span (scrollWidth vs clientWidth num flex min-w-0) e
 * escala a fonte imperativamente em useLayoutEffect (antes do paint → sem flash).
 * Re-mede a cada render (valor muda) e em resize do container (ResizeObserver).
 *
 * @param baseFontSize tamanho-base (ex. `var(--tv-value)`) — o hook o aplica e
 *   mede; sem overflow, fica no base. É a escala do peso (typeScaleForWeight).
 * @param floorPx piso de legibilidade (36 = regra de 3m do --tv-value).
 */
export function useFitToWidth<T extends HTMLElement>(baseFontSize: string, floorPx = 36) {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      // Aplica o tamanho-base (o hook é dono da fonte deste span) e mede o overflow.
      el.style.fontSize = baseFontSize;
      let fs = parseFloat(getComputedStyle(el).fontSize) || floorPx;
      // ENCOLHE ITERATIVAMENTE até CABER ou atingir o piso. One-shot linear
      // (base × avail/natural) UNDERSHRINKA — a relação fonte→largura não é
      // perfeitamente linear (letter-spacing, arredondamento), então parava com
      // `over` sobrando sem usar o headroom até 36px. O loop zera o `over`. Guard
      // contra loop infinito (fonte 96→36 = ~60 passos).
      let guard = 0;
      while (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && fs > floorPx && guard < 120) {
        fs = Math.max(fs - 1, floorPx);
        el.style.fontSize = `${fs}px`;
        guard++;
      }
    };

    fit();

    // RE-MEDIR APÓS O WEBFONT CARREGAR — NÃO REMOVER, não é redundante.
    // useLayoutEffect roda ANTES do webfont; a 1ª medição usa a fonte FALLBACK
    // (mais estreita) e encolhe de menos ("cabe" no fallback). Quando o webfont
    // troca, os glifos ficam mais largos e o `over` volta — mas o ResizeObserver
    // no parent NÃO re-dispara (o parent não muda de tamanho quando só a fonte
    // troca). document.fonts.ready é o gatilho certo pra re-rodar o loop com a
    // fonte real. (Mesmo defeito de "medir antes da página assentar" que mordeu o
    // harness de pixel — lá era waitForTimeout antes do loader; aqui, antes do font.)
    let cancelled = false;
    const fonts = (document as { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready?.then) fonts.ready.then(() => { if (!cancelled) fit(); });

    // Resize do card (rotação de página, densidade) re-dispara a medição.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    const parent = el.parentElement;
    if (ro && parent) ro.observe(parent);
    return () => { cancelled = true; ro?.disconnect(); };
  });

  return ref;
}
