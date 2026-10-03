/**
 * A moldura de uma janela do Estúdio — geometria, arrasto, redimensionamento,
 * seleção e remoção. Não sabe nada sobre métrica.
 *
 * ── Por que existe ──
 *
 * `MetricWindow` carregava a moldura E o conteúdo. Ao trazer os dashboards de
 * Comando para o Estúdio, apareceu um segundo tipo de janela — o card sob
 * medida (funil trapezoidal, pódio, jornada), que tem a MESMA moldura e um
 * corpo completamente diferente.
 *
 * As duas saídas eram duplicar 388 linhas de arrasto e snap, ou separar a
 * moldura. Duplicar significaria que toda correção de arrasto teria que ser
 * feita duas vezes — e a segunda seria esquecida.
 *
 * ── A regra que não pode se perder na extração ──
 *
 * 🔴 **Geometria em trânsito fica LOCAL.** Commitar a cada `pointermove` subiria
 * cada quadro do arrasto para o estado do painel e, desde o SCRUM-309, isso
 * agenda gravação no servidor: um arrasto de dois segundos viraria dezenas de
 * escritas. O pai só recebe o valor final, no `pointerup`.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { GripVertical, X } from "lucide-react";
import type { StudioWindow } from "@/modules/analytics/lib/metrics-studio-window";

/** Passo da grade. Mantido igual ao que a janela de métrica já usava. */
const GRID = 8;
const MIN_W = 200;
const MIN_H = 100;

type Handle = "e" | "s" | "se";

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const snap = (n: number) => Math.round(n / GRID) * GRID;
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

export interface StudioWindowFrameProps {
  win: StudioWindow;
  /** Lido pelo leitor de tela — o conteúdo é quem sabe o nome da janela. */
  ariaLabel: string;
  titulo: string;
  /** Linha de apoio sob o título. Some quando a janela fica pequena. */
  subtitulo?: ReactNode;
  /** SCRUM-308: em Visualização a janela é só leitura. */
  editavel: boolean;
  selected: boolean;
  canvas: { width: number; height: number };
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onRemove: (id: string) => void;
  /** Barra inferior de controles — só a janela de métrica tem. */
  rodape?: ReactNode;
  /**
   * O corpo já se desenha como cartões próprios. Em Visualização a moldura
   * some (sem fundo, sem título visível, sem respiro); em Edição ela volta
   * tracejada, porque o cabeçalho é a alça de arrasto.
   */
  semMoldura?: boolean;
  children: ReactNode;
}

export function StudioWindowFrame({
  win,
  ariaLabel,
  titulo,
  subtitulo,
  editavel,
  selected,
  canvas,
  onSelect,
  onMove,
  onResize,
  onRemove,
  rodape,
  semMoldura = false,
  children,
}: StudioWindowFrameProps) {
  const [draft, setDraft] = useState<Geometry | null>(null);
  const origin = useRef({ px: 0, py: 0, x: 0, y: 0, w: 0, h: 0 });
  const draftRef = useRef<Geometry | null>(null);

  const applyDraft = useCallback((next: Geometry | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const geo = draft ?? win;

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      origin.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
      applyDraft({ x: win.x, y: win.y, w: win.w, h: win.h });
      onSelect(win.id);
    },
    [win, onSelect, applyDraft],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draftRef.current) return;
      const o = origin.current;
      applyDraft({
        ...draftRef.current,
        x: clamp(snap(o.x + e.clientX - o.px), 0, Math.max(0, canvas.width - o.w)),
        y: Math.max(0, snap(o.y + e.clientY - o.py)),
      });
    },
    [canvas.width, applyDraft],
  );

  const endDrag = useCallback(() => {
    const current = draftRef.current;
    applyDraft(null);
    if (current) onMove(win.id, current.x, current.y);
  }, [win.id, onMove, applyDraft]);

  const startResize = useCallback(
    (handle: Handle) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      origin.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
      applyDraft({ x: win.x, y: win.y, w: win.w, h: win.h });
      onSelect(win.id);

      const mover = (ev: PointerEvent) => {
        const o = origin.current;
        const nextW =
          handle === "s" ? o.w : clamp(snap(o.w + ev.clientX - o.px), MIN_W, Math.max(MIN_W, canvas.width - o.x));
        const nextH =
          handle === "e" ? o.h : clamp(snap(o.h + ev.clientY - o.py), MIN_H, Math.max(MIN_H, canvas.height - o.y));
        applyDraft({ x: o.x, y: o.y, w: nextW, h: nextH });
      };
      const soltar = () => {
        const current = draftRef.current;
        applyDraft(null);
        if (current) onResize(win.id, current.w, current.h);
        window.removeEventListener("pointermove", mover);
        window.removeEventListener("pointerup", soltar);
      };
      window.addEventListener("pointermove", mover);
      window.addEventListener("pointerup", soltar);
    },
    [win, canvas, onSelect, onResize, applyDraft],
  );

  const compact = geo.h < 210 || geo.w < 300;
  // Sem moldura só em Visualização: em Edição a janela precisa da alça.
  const nua = semMoldura && !editavel;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      onPointerDown={editavel ? () => onSelect(win.id) : undefined}
      style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex: win.z }}
      className={cn(
        "group absolute flex flex-col",
        nua
          ? "overflow-visible"
          : semMoldura
            // Edição de um corpo que já é cartão: só a moldura tracejada, sem
            // pintar um cartão por baixo dos cartões.
            ? "overflow-hidden rounded-card border border-dashed border-foreground/20 bg-card/40"
            : "overflow-hidden rounded-card border border-card-border bg-card text-card-foreground",
        !nua && "transition-[box-shadow] duration-200",
        !nua && !semMoldura && (selected && editavel ? "shadow-relevo-alto" : "shadow-relevo hover:shadow-relevo-alto"),
        selected && editavel && "ring-2 ring-primary/70",
        editavel && !selected && !semMoldura && "outline-dashed outline-[1.5px] -outline-offset-[5px] outline-foreground/15",
        draft && "select-none",
      )}
    >
      {nua ? (
        // O nome continua para o leitor de tela (o grupo já tem aria-label).
        <h3 className="sr-only">{titulo}</h3>
      ) : (
        /* Header — também é a alça de arrasto. */
        <div
          onPointerDown={editavel ? startDrag : undefined}
          onPointerMove={editavel ? onDragMove : undefined}
          onPointerUp={editavel ? endDrag : undefined}
          onPointerCancel={editavel ? endDrag : undefined}
          className={cn(
            "flex items-start gap-2 px-4 pb-1.5 pt-3.5",
            editavel && "cursor-grab active:cursor-grabbing",
          )}
        >
          {editavel && <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[13.5px] font-bold tracking-[-0.02em]">{titulo}</h3>
            {!compact && subtitulo && (
              <p className="truncate text-[11px] text-muted-foreground">{subtitulo}</p>
            )}
          </div>

          {editavel && (
            <button
              type="button"
              // Sem isto o clique no X iniciaria um arrasto antes de remover.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onRemove(win.id)}
              aria-label={`Remover ${ariaLabel}`}
              className="-mr-1 -mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className={cn("flex min-h-0 flex-1 flex-col gap-1.5", !nua && "px-4 pb-3.5 pt-1")}>{children}</div>

      {rodape}

      {/* Alças de redimensionamento — só em Edição. */}
      {editavel && (
        <>
          <div onPointerDown={startResize("e")} className="absolute inset-y-3 right-0 w-1.5 cursor-ew-resize" aria-hidden />
          <div onPointerDown={startResize("s")} className="absolute inset-x-3 bottom-0 h-1.5 cursor-ns-resize" aria-hidden />
          <div onPointerDown={startResize("se")} className="absolute bottom-0.5 right-0.5 h-4 w-4 cursor-nwse-resize" aria-hidden>
            <svg viewBox="0 0 16 16" className="h-full w-full text-muted-foreground/40">
              <path d="M15 6 L6 15 M15 11 L11 15" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
