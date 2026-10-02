import { useState, useRef, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DraggableItem, StageRole } from "@/contracts/pipe";
import { motion } from "framer-motion";
import {
  Plus,
  MoreHorizontal,
  Trash2,
  FileDown,
  Loader2,
  ArrowUpDown,
  Check,
  CalendarClock,
  CalendarCheck,
  Trophy,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  COLUMN_SORT_OPTIONS,
  DEFAULT_COLUMN_SORT,
  sortColumnItems,
  type ColumnSortKey,
} from "@/modules/pipelines/lib/column-sort";

// `DraggableItem` tem definição canônica em contracts (quebra import direto
// leads→pipelines). Re-exportado para manter a API pública inalterada.
export type { DraggableItem };

export interface KanbanColumn<T extends DraggableItem> {
  id: string;
  title: string;
  color: string;
  /** Papel da etapa — ícone no cabeçalho e fundo das colunas de desfecho. */
  role?: StageRole | null;
  items: T[];
  totalCount?: number;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore?: () => void;
}

interface DraggableKanbanBoardProps<T extends DraggableItem> {
  columns: KanbanColumn<T>[];
  onStatusChange: (itemId: string, newStatus: string) => void;
  renderCard: (item: T, isDragging?: boolean) => React.ReactNode;
  columnClassName?: string;
  renderColumnFooter?: (column: KanbanColumn<T>) => React.ReactNode;
  /** Renders extra content in the column header (e.g. workflow badge) */
  renderColumnExtra?: (column: KanbanColumn<T>) => React.ReactNode;
  /** When provided, the column header three-dots menu shows "Excluir todos os leads desta etapa" */
  onDeleteAllLeads?: (stageId: string, stageTitle: string) => void;
  /** When provided, the column header three-dots menu shows "Exportar leads desta etapa" */
  onExportStage?: (stageId: string, stageTitle: string) => void;
  /** Quando fornecido, cada coluna ganha o rodapé "+ Novo negócio" da etapa. */
  onCreateInColumn?: (stageId: string, stageTitle: string) => void;
  /** When true, drag-and-drop is disabled (permission denied) */
  disabled?: boolean;
}

/**
 * Aviso de que a ordenação só alcança o que já foi carregado.
 *
 * Sem ele, "Ordenar por valor" numa etapa com 100 cards mostraria o maior dos
 * 20 primeiros como se fosse o maior da etapa — o mesmo tipo de meia-verdade
 * que faz a soma por coluna errar acima de 20 cards.
 */
function PartialSortNotice() {
  return (
    <p className="mx-2.5 mb-1.5 shrink-0 text-[10.5px] leading-tight text-muted-foreground/80">
      Ordena os cards já carregados — role até o fim pra incluir o resto.
    </p>
  );
}

/** Ícone por papel; etapa aberta fica com o quadradinho da cor dela. */
const ROLE_ICON: Partial<Record<StageRole, { icon: LucideIcon; label: string; className: string }>> = {
  meeting_booked: { icon: CalendarClock, label: "Etapa de reunião marcada", className: "text-foreground/70" },
  meeting_held: { icon: CalendarCheck, label: "Etapa de reunião realizada", className: "text-foreground/70" },
  won: { icon: Trophy, label: "Etapa de ganho", className: "text-success-strong" },
  lost: { icon: CircleX, label: "Etapa de perda", className: "text-destructive" },
};

function DroppableColumn<T extends DraggableItem>({
  column,
  children,
  className,
  renderColumnFooter,
  renderColumnExtra,
  onDeleteAllLeads,
  onExportStage,
  onCreateInColumn,
  sortKey,
  onSortChange,
}: {
  column: KanbanColumn<T>;
  children: React.ReactNode;
  className?: string;
  renderColumnFooter?: (column: KanbanColumn<T>) => React.ReactNode;
  renderColumnExtra?: (column: KanbanColumn<T>) => React.ReactNode;
  onDeleteAllLeads?: (stageId: string, stageTitle: string) => void;
  onExportStage?: (stageId: string, stageTitle: string) => void;
  onCreateInColumn?: (stageId: string, stageTitle: string) => void;
  sortKey?: ColumnSortKey;
  onSortChange?: (stageId: string, sortKey: ColumnSortKey) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  });

  return (
    <motion.div
      ref={setNodeRef}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      data-stage={column.id}
      className={cn(
        // Coluna é superfície própria (protótipo `.specs/mockups/funis-redesign/`):
        // o board deixa de ser fundo liso e cada etapa ganha contorno, o que dá
        // alvo visível pro arrasto e separa etapa cheia de etapa vazia.
        // `p-0` anula o `p-4` que `.kanban-column` aplica no CSS global. O
        // recheio agora é por faixa (cabeçalho `px-3`, corpo `px-2.5`); somados
        // davam 26px de cada lado e o card caía pra 240px dentro de 292px.
        //
        // V5: a coluna é uma raia AFUNDADA (`bg-sunken`) — um degrau entre a
        // bancada e o cartão, nos dois temas — e os cards brancos de bento
        // assentam sobre ela. Raio de cartão, contorno fino; o alvo do arrasto
        // acende em ouro suave.
        //
        // V5 (mockup): 272 px de piso e cresce para dividir a largura quando
        // há poucas etapas (`flex-[1_0_272px]`, teto de 380 px). Ganho e perda
        // ganham fundo tintado — o desfecho se lê de longe.
        "kanban-column flex min-w-[272px] max-w-[380px] flex-[1_0_272px] flex-col p-0",
        "overflow-hidden rounded-card border border-border/60 transition-[background-color,box-shadow] duration-200",
        column.role === "won" ? "bg-success/[.07]" : column.role === "lost" ? "bg-destructive/[.06]" : "bg-sunken",
        isOver && "bg-primary-soft/50 ring-2 ring-primary/60",
        className
      )}
    >
      <div className="flex shrink-0 items-center gap-2 px-3.5 pb-2.5 pt-3">
        {(() => {
          const role = column.role ? ROLE_ICON[column.role] : undefined;
          if (role) {
            const Icon = role.icon;
            return <Icon className={cn("size-4 shrink-0", role.className)} aria-label={role.label} />;
          }
          return (
            <span
              className="size-2 shrink-0 rounded-[3px]"
              style={{ backgroundColor: column.color }}
              aria-hidden
            />
          );
        })()}
        <h3 className="truncate text-xs font-extrabold tracking-[-0.01em]">
          {column.title}
        </h3>
        <span className="inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-card px-1.5 text-[10.5px] font-extrabold tabular-nums text-foreground shadow-relevo">
          {column.totalCount ?? column.items.length}
        </span>
        {renderColumnExtra && renderColumnExtra(column)}
        <div className="ml-auto flex items-center gap-1">
          {(onExportStage || onDeleteAllLeads || onSortChange) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Ações da etapa ${column.title}`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onSortChange && (
                  <>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <ArrowUpDown className="w-4 h-4 mr-2" />
                        Ordenar por
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {COLUMN_SORT_OPTIONS.map((opt) => (
                          <DropdownMenuItem
                            key={opt.key}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSortChange(column.id, opt.key);
                            }}
                          >
                            <Check
                              className={cn(
                                "w-4 h-4 mr-2",
                                sortKey === opt.key ? "opacity-100" : "opacity-0",
                              )}
                            />
                            {opt.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                  </>
                )}
                {onExportStage && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onExportStage(column.id, column.title);
                    }}
                  >
                    <FileDown className="w-4 h-4 mr-2" />
                    Exportar leads desta etapa
                  </DropdownMenuItem>
                )}
                {onDeleteAllLeads && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteAllLeads(column.id, column.title);
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Mover todos para lixeira
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button className="rounded-lg p-1.5 transition-colors hover:bg-card">
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {renderColumnFooter && renderColumnFooter(column)}

      {sortKey && sortKey !== DEFAULT_COLUMN_SORT && column.hasMore && <PartialSortNotice />}

      <div className="min-h-[100px] flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-2.5">
        {children}
        {column.hasMore && column.onLoadMore && (
          <LoadMoreSentinel onLoadMore={column.onLoadMore} isFetching={column.isFetchingMore ?? false} />
        )}
        {!column.hasMore && column.isFetchingMore && (
          <div className="flex justify-center py-2">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Criar direto na etapa. Substitui o "+" que existia no cabeçalho e não
          tinha handler nenhum — afordância que prometia e não fazia. */}
      {onCreateInColumn && (
        <button
          type="button"
          onClick={() => onCreateInColumn(column.id, column.title)}
          data-testid={`column-create-${column.id}`}
          aria-label={`Adicionar em ${column.title}`}
          title={`Adicionar em ${column.title}`}
          className={cn(
            "mx-2.5 mb-2.5 flex min-h-[44px] shrink-0 items-center justify-center",
            "rounded-2xl border-[1.5px] border-dashed border-border text-muted-foreground",
            "transition-colors duration-150 hover:border-primary/60 hover:bg-card hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Plus className="size-4" aria-hidden />
        </button>
      )}
    </motion.div>
  );
}

function SortableCard<T extends DraggableItem>({
  item,
  renderCard,
}: {
  item: T;
  renderCard: (item: T, isDragging?: boolean) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onPointerDown={(event) => {
        // Portais pertencem à árvore React do card, mas ficam fora dele no DOM.
        // Deixar o evento chegar ao documento preserva o clique-fora do Radix.
        if (event.target instanceof Node && event.currentTarget.contains(event.target)) {
          listeners?.onPointerDown?.(event);
        }
      }}
      className={cn(
        "relative group/card cursor-grab active:cursor-grabbing touch-none",
        isDragging && "opacity-50 z-50"
      )}
    >
      {renderCard(item, isDragging)}
    </div>
  );
}

function LoadMoreSentinel({ onLoadMore, isFetching }: { onLoadMore: () => void; isFetching: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetching) onLoadMore();
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore, isFetching]);

  return (
    <div ref={ref} className="flex justify-center py-2">
      {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

export function DraggableKanbanBoard<T extends DraggableItem>({
  columns,
  onStatusChange,
  renderCard,
  columnClassName,
  renderColumnFooter,
  renderColumnExtra,
  onDeleteAllLeads,
  onExportStage,
  onCreateInColumn,
  disabled,
}: DraggableKanbanBoardProps<T>) {
  const [activeItem, setActiveItem] = useState<T | null>(null);
  // Ordenação por coluna: cada etapa guarda a sua. Fica no board (e não na
  // página) porque é preferência de leitura da coluna, não recorte de dado —
  // não entra nas visualizações salvas nem na URL.
  const [sortByColumn, setSortByColumn] = useState<Record<string, ColumnSortKey>>({});
  const handleSortChange = useCallback((stageId: string, sortKey: ColumnSortKey) => {
    setSortByColumn((prev) => ({ ...prev, [stageId]: sortKey }));
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const syncing = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setScrollWidth(el.scrollWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [columns]);

  const handleTopScroll = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    if (scrollRef.current && topScrollRef.current) {
      scrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
    syncing.current = false;
  }, []);

  const handleMainScroll = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    if (topScrollRef.current && scrollRef.current) {
      topScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }
    syncing.current = false;
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const findItemById = (id: string): T | null => {
    for (const column of columns) {
      const item = column.items.find((item) => item.id === id);
      if (item) return item;
    }
    return null;
  };

  const findColumnByItemId = (id: string): string | null => {
    for (const column of columns) {
      const item = column.items.find((item) => item.id === id);
      if (item) return column.id;
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const item = findItemById(active.id as string);
    setActiveItem(item);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);

    if (!over || disabled) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Find the column the item is being dropped into
    const overColumn = columns.find((col) => col.id === overId);
    const itemColumn = findColumnByItemId(activeId);

    if (overColumn) {
      // Dropped directly on a column
      if (itemColumn !== overColumn.id) {
        onStatusChange(activeId, overColumn.id);
      }
    } else {
      // Dropped on another item - find which column that item is in
      const targetColumn = findColumnByItemId(overId);
      if (targetColumn && itemColumn !== targetColumn) {
        onStatusChange(activeId, targetColumn);
      }
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeColumn = findColumnByItemId(activeId);
    const overColumn = columns.find((col) => col.id === overId)?.id || findColumnByItemId(overId);

    // Update visual feedback happens automatically via isOver in DroppableColumn
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
    >
      {/* Top scrollbar */}
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="overflow-x-auto overflow-y-hidden"
        style={{ height: 12 }}
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>

      {/* Kanban columns */}
      <div
        ref={scrollRef}
        onScroll={handleMainScroll}
        // O topo V5 do funil tem cabeçalho, pílula, faixa de funis e barra de
        // controle; o quadro ocupa o resto da altura e rola por coluna.
        className="flex gap-3 overflow-x-auto overflow-y-hidden pb-4 max-h-[calc(100vh-300px)] min-h-[420px] scrollbar-hide"
      >
        {columns.map((column) => {
          const columnSort = sortByColumn[column.id] ?? DEFAULT_COLUMN_SORT;
          const sortedItems = sortColumnItems(column.items, columnSort);
          return (
            <DroppableColumn
              key={column.id}
              column={column}
              className={columnClassName}
              renderColumnFooter={renderColumnFooter}
              renderColumnExtra={renderColumnExtra}
              onDeleteAllLeads={onDeleteAllLeads}
              onExportStage={onExportStage}
              onCreateInColumn={onCreateInColumn}
              sortKey={columnSort}
              onSortChange={handleSortChange}
            >
              <SortableContext
                items={sortedItems.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                {sortedItems.map((item) => (
                  <SortableCard
                    key={item.id}
                    item={item}
                    renderCard={renderCard}
                  />
                ))}
              </SortableContext>
            </DroppableColumn>
          );
        })}
      </div>

      <DragOverlay>
        {activeItem ? (
          <div className="rotate-2 scale-[1.03] cursor-grabbing [&>*]:shadow-relevo-alto">
            {renderCard(activeItem, true)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
