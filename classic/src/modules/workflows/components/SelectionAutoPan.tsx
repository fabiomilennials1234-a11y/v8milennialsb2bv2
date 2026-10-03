import { useEffect, useRef } from "react";
import { useStore, useStoreApi } from "@xyflow/react";

/**
 * Auto-pan durante a seleção em massa (marquee).
 *
 * O React Flow desenha a caixa de seleção (Ctrl/Shift + arrastar) ancorada em
 * coordenadas de tela e NÃO acompanha a borda do viewport — então não dá pra
 * selecionar nós que estão fora da área visível. Este componente preenche essa
 * lacuna: enquanto a seleção está ativa, se o mouse encosta numa borda, o canvas
 * faz pan naquela direção, revelando (e selecionando) o que está além da tela.
 *
 * A âncora da seleção (startX/startY) é guardada pelo React Flow em px de tela,
 * então a deslocamos pelo mesmo delta do pan a cada frame — assim ela fica fixa
 * no espaço do fluxo e a seleção ESTENDE pra direção do pan em vez de perder os
 * itens que já estavam selecionados do outro lado.
 *
 * Deve ser renderizado como filho de <ReactFlow> (precisa do store interno).
 */

// Distância da borda (px) onde o auto-pan começa.
const EDGE_THRESHOLD = 50;
// Velocidade máxima do pan (px por frame), atingida bem na borda.
const MAX_SPEED = 16;

function speedFor(overlap: number): number {
  // overlap ∈ [0, EDGE_THRESHOLD] → quanto mais perto da borda, mais rápido.
  const ratio = Math.min(1, overlap / EDGE_THRESHOLD);
  return Math.max(1, ratio * MAX_SPEED);
}

export function SelectionAutoPan() {
  const store = useStoreApi();
  const userSelectionActive = useStore((s) => s.userSelectionActive);
  const pointer = useRef({ x: 0, y: 0, set: false });
  const rafId = useRef<number | null>(null);

  // Rastreia a posição do ponteiro enquanto a seleção está ativa — o mouse pode
  // ficar parado na borda, então precisamos do último valor conhecido.
  useEffect(() => {
    if (!userSelectionActive) {
      pointer.current.set = false;
      return;
    }
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, set: true };
    };
    window.addEventListener("pointermove", onMove, true);
    return () => window.removeEventListener("pointermove", onMove, true);
  }, [userSelectionActive]);

  useEffect(() => {
    if (!userSelectionActive) return;
    const { domNode } = store.getState();
    if (!domNode) return;
    // A caixa de seleção é tratada no elemento `.react-flow__pane`. Disparamos
    // pointermove sintético nele pra reaproveitar a lógica de seleção nativa.
    const pane = domNode.querySelector<HTMLElement>(".react-flow__pane");
    if (!pane) return;

    const tick = () => {
      const state = store.getState();
      if (!state.userSelectionActive || !state.userSelectionRect) {
        rafId.current = null;
        return;
      }

      // Ainda não temos uma leitura real do ponteiro nesta seleção — espera o
      // próximo frame pra não dar um pan errado a partir de (0,0).
      if (!pointer.current.set) {
        rafId.current = requestAnimationFrame(tick);
        return;
      }

      const bounds = domNode.getBoundingClientRect();
      const { x: px, y: py } = pointer.current;

      let dx = 0;
      let dy = 0;

      const leftDist = px - bounds.left;
      const rightDist = bounds.right - px;
      const topDist = py - bounds.top;
      const bottomDist = bounds.bottom - py;

      if (leftDist < EDGE_THRESHOLD) dx = speedFor(EDGE_THRESHOLD - leftDist);
      else if (rightDist < EDGE_THRESHOLD) dx = -speedFor(EDGE_THRESHOLD - rightDist);

      if (topDist < EDGE_THRESHOLD) dy = speedFor(EDGE_THRESHOLD - topDist);
      else if (bottomDist < EDGE_THRESHOLD) dy = -speedFor(EDGE_THRESHOLD - bottomDist);

      if (dx !== 0 || dy !== 0) {
        // 1. Pan do viewport. Durante a seleção marquee o React Flow DESLIGA o
        //    handler de zoom do d3 (XYPanZoom.update → destroy quando
        //    userSelectionActive), então `panBy`/`setViewport` viram no-op: o
        //    transform interno do d3 muda mas o store nunca é notificado. Por
        //    isso escrevemos o transform direto no store (que é o que o
        //    <Viewport> renderiza) e sincronizamos o d3 pra não dar pulo ao
        //    soltar a seleção.
        const [tx, ty, zoom] = state.transform;
        const next: [number, number, number] = [tx + dx, ty + dy, zoom];
        const rect = store.getState().userSelectionRect;
        store.setState({
          transform: next,
          // 2. Mantém a âncora fixa no espaço do fluxo (ela vive em px de tela,
          //    então desloca pelo mesmo delta do transform).
          userSelectionRect: rect
            ? { ...rect, startX: rect.startX + dx, startY: rect.startY + dy }
            : rect,
        });
        state.panZoom?.syncViewport({ x: next[0], y: next[1], zoom: next[2] });
        // 3. Reavalia a seleção na posição atual do mouse — assim os nós recém
        //    revelados entram na seleção mesmo com o mouse parado.
        pane.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: px,
            clientY: py,
            bubbles: true,
            cancelable: true,
            view: window,
            isPrimary: true,
          })
        );
      }

      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
    };
  }, [userSelectionActive, store]);

  return null;
}
