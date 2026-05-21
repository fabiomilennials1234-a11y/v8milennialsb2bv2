import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ChecklistItemRow } from "./ChecklistItemRow";
import {
  useChecklistItems,
  useCreateChecklistItem,
  useToggleChecklistItem,
  useUpdateChecklistItem,
  useDeleteChecklistItem,
  useUpdateChecklist,
  useDeleteChecklist,
  type ChecklistWithCounts,
} from "@/hooks/useChecklists";

interface ChecklistCardProps {
  checklist: ChecklistWithCounts;
}

export const ChecklistCard = memo(function ChecklistCard({ checklist }: ChecklistCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(checklist.title);

  const { data: items = [] } = useChecklistItems(expanded ? checklist.id : null);
  const createItem = useCreateChecklistItem();
  const toggleItem = useToggleChecklistItem();
  const updateItem = useUpdateChecklistItem();
  const deleteItem = useDeleteChecklistItem();
  const updateChecklist = useUpdateChecklist();
  const deleteChecklist = useDeleteChecklist();

  const progress = checklist.total_items > 0
    ? Math.round((checklist.completed_items / checklist.total_items) * 100)
    : 0;

  const handleAddItem = () => {
    const trimmed = newItemTitle.trim();
    if (!trimmed) return;
    createItem.mutate({
      checklist_id: checklist.id,
      title: trimmed,
      position: items.length,
    });
    setNewItemTitle("");
  };

  const handleAddItemKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddItem();
  };

  const handleSaveTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== checklist.title) {
      updateChecklist.mutate({ id: checklist.id, title: trimmed });
    } else {
      setEditTitle(checklist.title);
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSaveTitle();
    if (e.key === "Escape") {
      setEditTitle(checklist.title);
      setIsEditingTitle(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card overflow-hidden"
    >
      {/* Header */}
      <div
        className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isEditingTitle ? (
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={handleTitleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  className="h-7 text-sm font-semibold"
                  autoFocus
                />
              ) : (
                <h3 className="font-semibold text-sm truncate">{checklist.title}</h3>
              )}
            </div>

            {checklist.description && !expanded && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{checklist.description}</p>
            )}

            <div className="flex items-center gap-3 mt-2">
              <Progress value={progress} className="h-1.5 flex-1" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {checklist.completed_items}/{checklist.total_items}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setIsEditingTitle(true)}
            >
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => deleteChecklist.mutate(checklist.id)}
            >
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
            </Button>
          </div>
        </div>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-border pt-3">
              {checklist.description && (
                <p className="text-xs text-muted-foreground mb-3">{checklist.description}</p>
              )}

              {/* Items list */}
              <div className="space-y-0.5">
                <AnimatePresence mode="popLayout">
                  {items.map((item) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      onToggle={(id, completed) => toggleItem.mutate({ id, checklist_id: checklist.id, is_completed: completed })}
                      onUpdate={(id, title) => updateItem.mutate({ id, title })}
                      onDelete={(id) => deleteItem.mutate(id)}
                    />
                  ))}
                </AnimatePresence>
              </div>

              {/* Add item input */}
              <div className="flex items-center gap-2 mt-3">
                <Plus className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <Input
                  placeholder="Adicionar item..."
                  value={newItemTitle}
                  onChange={(e) => setNewItemTitle(e.target.value)}
                  onKeyDown={handleAddItemKeyDown}
                  className="h-8 text-sm"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleAddItem}
                  disabled={!newItemTitle.trim()}
                  className="h-8 px-3"
                >
                  Adicionar
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
