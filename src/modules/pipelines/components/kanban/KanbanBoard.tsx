import { useRef, useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, MoreHorizontal } from "lucide-react";
import { KanbanCard, Lead } from "./KanbanCard";

interface KanbanColumn {
  id: string;
  title: string;
  color: string;
  leads: Lead[];
}

interface KanbanBoardProps {
  columns: KanbanColumn[];
  onLeadClick?: (lead: Lead) => void;
}

export function KanbanBoard({ columns, onLeadClick }: KanbanBoardProps) {
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

  return (
    <>
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="overflow-x-auto overflow-y-hidden"
        style={{ height: 12 }}
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>

      <div
        ref={scrollRef}
        onScroll={handleMainScroll}
        className="flex gap-4 overflow-x-auto overflow-y-hidden pb-4 max-h-[calc(100vh-220px)] scrollbar-hide"
      >
        {columns.map((column, colIndex) => (
          <motion.div
            key={column.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: colIndex * 0.05 }}
            className="kanban-column min-w-[300px] max-w-[320px] flex-shrink-0 flex flex-col"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: column.color }}
                />
                <h3 className="font-semibold text-sm">{column.title}</h3>
                <span className="bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full">
                  {column.leads.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-1.5 rounded-lg hover:bg-background transition-colors">
                  <Plus className="w-4 h-4 text-muted-foreground" />
                </button>
                <button className="p-1.5 rounded-lg hover:bg-background transition-colors">
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>

            <div className="space-y-3 overflow-y-auto flex-1 min-h-0">
              {column.leads.map((lead, leadIndex) => (
                <motion.div
                  key={lead.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2, delay: leadIndex * 0.03 }}
                >
                  <KanbanCard lead={lead} onClick={() => onLeadClick?.(lead)} />
                </motion.div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </>
  );
}
