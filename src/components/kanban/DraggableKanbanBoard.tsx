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
import { motion } from "framer-motion";
import { Plus, MoreHorizontal, GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export interface DraggableItem {
  id: string;
  [key: string]: any;
}

export interface KanbanColumn<T extends DraggableItem> {
  id: string;
  title: string;
  color: string;
  items: T[];
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
  /** When true, drag-and-drop is disabled (permission denied) */
  disabled?: boolean;
}

function DroppableColumn<T extends DraggableItem>({
  column,
  children,
  className,
  renderColumnFooter,
  renderColumnExtra,
  onDeleteAllLeads,
}: {
  column: KanbanColumn<T>;
  children: React.ReactNode;
  className?: string;
  renderColumnFooter?: (column: KanbanColumn<T>) => React.ReactNode;
  renderColumnExtra?: (column: KanbanColumn<T>) => React.ReactNode;
  onDeleteAllLeads?: (stageId: string, stageTitle: string) => void;
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
      className={cn(
        "kanban-column min-w-[320px] max-w-[360px] flex-shrink-0 flex flex-col transition-all duration-200",
        isOver && "ring-2 ring-primary/50 bg-primary/5",
        className
      )}
    >
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: column.color }}
          />
          <h3 className="font-semibold text-sm">{column.title}</h3>
          <span className="bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full">
            {column.items.length}
          </span>
          {renderColumnExtra && renderColumnExtra(column)}
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-lg hover:bg-background transition-colors">
            <Plus className="w-4 h-4 text-muted-foreground" />
          </button>
          {onDeleteAllLeads ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAllLeads(column.id, column.title);
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Excluir todos os leads desta etapa
                </DropdownMenuItem>
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

      <div className="space-y-3 min-h-[100px] overflow-y-auto flex-1 min-h-0">{children}</div>
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
      className={cn(
        "relative group/card",
        isDragging && "opacity-50 z-50"
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="pl-2">
        {renderCard(item, isDragging)}
      </div>
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
  disabled,
}: DraggableKanbanBoardProps<T>) {
  const [activeItem, setActiveItem] = useState<T | null>(null);
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
        {columns.map((column) => (
          <DroppableColumn
            key={column.id}
            column={column}
            className={columnClassName}
            renderColumnFooter={renderColumnFooter}
            renderColumnExtra={renderColumnExtra}
            onDeleteAllLeads={onDeleteAllLeads}
          >
            <SortableContext
              items={column.items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              {column.items.map((item) => (
                <SortableCard
                  key={item.id}
                  item={item}
                  renderCard={renderCard}
                />
              ))}
            </SortableContext>
          </DroppableColumn>
        ))}
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
