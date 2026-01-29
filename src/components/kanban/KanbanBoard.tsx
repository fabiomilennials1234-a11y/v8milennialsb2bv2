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
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((column, colIndex) => (
        <motion.div
          key={column.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: colIndex * 0.05 }}
          className="kanban-column min-w-[300px] max-w-[320px] flex-shrink-0"
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

          <div className="space-y-3">
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
  );
}
