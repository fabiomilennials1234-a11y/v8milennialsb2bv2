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
import type { DraggableItem } from "@/contracts/pipe";
import { motion } from "framer-motion";
import { Plus, MoreHorizontal, Trash2, FileDown, Loader2, ArrowUpDown, Check } from "lucide-react";
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
        "kanban-column w-[292px] min-w-[292px] max-w-[292px] flex-shrink-0 flex flex-col",
        "rounded-xl bg-muted/25 overflow-hidden transition-all duration-200",
        isOver && "ring-2 ring-primary/50 bg-primary/5",
        className
      )}
    >
      <div className="flex items-center gap-2 shrink-0 px-3 pt-3 pb-2">
        <div
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: column.color }}
        />
        <h3 className="text-[12.5px] font-semibold tracking-[-0.01em] truncate">
          {column.title}
        </h3>
        <span className="rounded-full bg-muted px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-muted-foreground">
          {column.totalCount ?? column.items.length}
        </span>
        {renderColumnExtra && renderColumnExtra(column)}
        <div className="ml-auto flex items-center gap-1">
          {(onExportStage || onDeleteAllLeads || onSortChange) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
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
            <button className="p-1.5 rounded-lg hover:bg-background transition-colors">
              <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {renderColumnFooter && renderColumnFooter(column)}

      {sortKey && sortKey !== DEFAULT_COLUMN_SORT && column.hasMore && <PartialSortNotice />}

      <div className="flex-1 min-h-[100px] space-y-2 overflow-y-auto px-2.5 pb-2.5">
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
          className={cn(
            "mx-2.5 mb-2.5 flex shrink-0 items-center justify-center gap-1.5",
            "rounded-lg border border-dashed border-border px-2 py-2",
            "text-[11.5px] font-medium text-muted-foreground",
            "transition-colors duration-150 hover:border-primary hover:text-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Plus className="size-3.5" aria-hidden />
          Novo negócio
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
        className="flex gap-4 overflow-x-auto overflow-y-hidden pb-4 max-h-[calc(100vh-220px)] scrollbar-hide"
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
          <div className="rotate-3 scale-105">
            {renderCard(activeItem, true)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
