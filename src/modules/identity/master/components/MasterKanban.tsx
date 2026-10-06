/**
 * Kanban das centrais da Área Dev (Operação, Implementação).
 *
 * Genérico de propósito, e separado do `DraggableKanbanBoard` dos Funis: lá a
 * coluna É o dado (o lead mora na etapa). Aqui a coluna é DERIVADA do dado
 * (regra OP-8 / IM-7) — arrastar pede um fato ao banco, e quem decide se o
 * fato pode acontecer é `canDrop`, a mesma função pura que os testes travam.
 *
 * Enquanto o cartão está no ar, cada coluna diz se aceita ou não, e por quê:
 * a regra aparece ANTES do erro, não depois.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type DropVerdict = { ok: true } | { ok: false; reason: string };

export interface KanbanColumnDef<C extends string> {
  id: C;
  label: string;
  hint: string;
}

interface MasterKanbanProps<T, C extends string> {
  columns: readonly KanbanColumnDef<C>[];
  items: Record<C, T[]>;
  getId: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  canDrop: (item: T, to: C) => DropVerdict;
  onMove: (item: T, to: C) => void;
  onOpen: (item: T) => void;
  /** Rótulo acessível do quadro inteiro. */
  label: string;
  /** Texto da coluna vazia. */
  emptyLabel?: (column: C) => string;
  /** Teto de cartões por coluna antes do "+N" — colunas terminais crescem sem parar. */
  columnLimit?: Partial<Record<C, number>>;
}

export function MasterKanban<T, C extends string>({
  columns,
  items,
  getId,
  renderCard,
  canDrop,
  onMove,
  onOpen,
  label,
  emptyLabel = () => "Nada aqui.",
  columnLimit = {},
}: MasterKanbanProps<T, C>) {
  const sensors = useSensors(
    // Mouse: 6 px de folga — um clique abre o cartão, só o arrasto de verdade move.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Toque: pressão longa. Com distância, deslizar o carrossel de colunas no
    // celular levantava o cartão no lugar de rolar.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const [active, setActive] = useState<T | null>(null);
  const [expanded, setExpanded] = useState<Partial<Record<C, boolean>>>({});

  const byId = useMemo(() => {
    const m = new Map<string, T>();
    for (const c of columns) for (const it of items[c.id]) m.set(getId(it), it);
    return m;
  }, [columns, items, getId]);

  const verdicts = useMemo(() => {
    if (!active) return null;
    return Object.fromEntries(columns.map((c) => [c.id, canDrop(active, c.id)])) as Record<C, DropVerdict>;
  }, [active, columns, canDrop]);

  function handleStart(e: DragStartEvent) {
    setActive(byId.get(String(e.active.id)) ?? null);
  }

  function handleEnd(e: DragEndEvent) {
    const item = byId.get(String(e.active.id));
    setActive(null);
    if (!item || !e.over) return;
    const to = String(e.over.id) as C;
    const verdict = canDrop(item, to);
    if (verdict.ok) onMove(item, to);
    // Soltar na própria coluna é desistir, não erro.
    else if (!items[to].some((it) => getId(it) === getId(item))) toast.error(verdict.reason);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => setActive(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable: "Espaço para levantar o cartão, setas para trocar de coluna, espaço para soltar.",
        },
      }}
    >
      <div
        role="region"
        aria-label={label}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide sm:mx-0 sm:px-0 lg:grid lg:snap-none lg:overflow-visible"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((col) => {
          const list = items[col.id];
          const limit = columnLimit[col.id];
          const shown = limit && !expanded[col.id] ? list.slice(0, limit) : list;
          return (
            <KanbanColumn
              key={col.id}
              column={col}
              count={list.length}
              verdict={verdicts?.[col.id] ?? null}
              isSource={!!active && list.some((it) => getId(it) === getId(active))}
            >
              {list.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">{emptyLabel(col.id)}</p>
              ) : (
                shown.map((it) => (
                  <DraggableCard key={getId(it)} id={getId(it)} onOpen={() => onOpen(it)}>
                    {renderCard(it)}
                  </DraggableCard>
                ))
              )}
              {limit && list.length > limit && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [col.id]: !e[col.id] }))}
                  className="w-full rounded-xl py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {expanded[col.id] ? "Mostrar menos" : `Mostrar mais ${list.length - limit}`}
                </button>
              )}
            </KanbanColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}>
        {active ? (
          <div className="rotate-[1.5deg] cursor-grabbing rounded-2xl shadow-relevo-alto">{renderCard(active)}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn<C extends string>({
  column,
  count,
  verdict,
  isSource,
  children,
}: {
  column: KanbanColumnDef<C>;
  count: number;
  verdict: DropVerdict | null;
  isSource: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const dragging = verdict !== null;
  const accepts = verdict?.ok === true;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.label}, ${count} ${count === 1 ? "item" : "itens"}`}
      className={cn(
        "flex min-h-[320px] w-[82%] shrink-0 snap-start flex-col rounded-card border border-card-border bg-card/70 p-2 shadow-relevo backdrop-blur-[2px] transition-[box-shadow,opacity,background-color] duration-200 ease-standard sm:w-[300px] lg:w-auto",
        dragging && accepts && "bg-card ring-2 ring-primary/60",
        dragging && accepts && isOver && "ring-primary shadow-brilho-ouro",
        dragging && !accepts && !isSource && "opacity-55",
      )}
    >
      <header className="px-2 pb-2 pt-1.5">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-bold tracking-tight">{column.label}</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground/70">
            {count}
          </span>
        </div>
        {dragging && !accepts && !isSource ? (
          <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
            <Lock className="mt-px h-3 w-3 shrink-0" aria-hidden />
            {(verdict as { reason: string }).reason}
          </p>
        ) : (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{column.hint}</p>
        )}
      </header>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </section>
  );
}

function DraggableCard({ id, onOpen, children }: { id: string; onOpen: () => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Enter abre; espaço continua sendo do dnd-kit (levantar o cartão).
        if (e.key === "Enter") onOpen();
        listeners?.onKeyDown?.(e);
      }}
      className={cn(
        "cursor-grab touch-manipulation rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isDragging && "opacity-30",
      )}
    >
      {children}
    </div>
  );
}
