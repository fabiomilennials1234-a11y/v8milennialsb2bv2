/**
 * Janela de um card SOB MEDIDA — mesma moldura das janelas de métrica, corpo
 * vindo do registry.
 *
 * A moldura é `StudioWindowFrame`, compartilhada com `MetricWindow`: arrastar,
 * redimensionar, selecionar e remover se comportam igual, porque é literalmente
 * o mesmo código. Se fossem duas implementações, a segunda envelheceria.
 *
 * O que este card NÃO tem, de propósito: seletor de gráfico e de corte. Eles só
 * fazem sentido quando o conteúdo é uma medida do motor — um pódio de
 * vendedores não vira "linha" nem "pizza". Oferecer o controle e ignorá-lo
 * seria pior que não oferecer.
 */

import { StudioWindowFrame } from "./StudioWindowFrame";
import { resolveFixedCard } from "@/modules/analytics/lib/metrics-studio-fixed-cards";
import type { StudioWindow } from "@/modules/analytics/lib/metrics-studio-window";

interface FixedWindowProps {
  win: StudioWindow;
  range: { start: Date; end: Date };
  editavel: boolean;
  selected: boolean;
  canvas: { width: number; height: number };
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onRemove: (id: string) => void;
}

export function FixedWindow({
  win,
  range,
  editavel,
  selected,
  canvas,
  onSelect,
  onMove,
  onResize,
  onRemove,
}: FixedWindowProps) {
  const card = resolveFixedCard(win.fixo);

  // Chave desconhecida — painel gravado por versão mais nova, ou card retirado
  // do registry. Não desenha, não estoura. Mesmo tratamento que o canvas já dá
  // a métrica que sumiu do catálogo: a ausência de UM card não pode derrubar o
  // painel inteiro.
  if (!card) return null;

  const Corpo = card.render;

  return (
    <StudioWindowFrame
      win={win}
      ariaLabel={card.label}
      titulo={card.label}
      subtitulo={card.descricao}
      editavel={editavel}
      selected={selected}
      canvas={canvas}
      onSelect={onSelect}
      onMove={onMove}
      onResize={onResize}
      onRemove={onRemove}
    >
      {/* `min-h-0` é o que impede o corpo de empurrar a moldura: sem ele, um
          card com conteúdo alto estoura a altura que o usuário escolheu. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Corpo range={range} />
      </div>
    </StudioWindowFrame>
  );
}
