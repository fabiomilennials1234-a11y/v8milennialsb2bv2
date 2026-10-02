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
} from "@/modules/engagement/hooks/useChecklists";

interface ChecklistCardProps {
  checklist: ChecklistWithCounts;
  /** Abre já com os itens à mostra (edição a partir do cartão de ouro). */
  defaultExpanded?: boolean;
  /** Chamado depois de excluir o template (quem abriu fecha o diálogo). */
  onDeleted?: () => void;
}

export const ChecklistCard = memo(function ChecklistCard({ checklist, defaultExpanded = false, onDeleted }: ChecklistCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
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
      className="overflow-hidden rounded-card border border-card-border bg-card text-card-foreground shadow-relevo"
    >
      {/* Header */}
      <div
        className="cursor-pointer px-5 py-4 transition-colors hover:bg-muted/40"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-[10px] bg-muted text-foreground/60">
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isEditingTitle ? (
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={handleTitleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  className="h-8 text-sm font-semibold"
                  autoFocus
                />
              ) : (
                <h3 className="truncate text-[15px] font-bold tracking-[-0.02em]">{checklist.title}</h3>
              )}
            </div>

            {checklist.description && !expanded && (
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{checklist.description}</p>
            )}

            <div className="mt-2.5 flex items-center gap-3">
              <Progress
                value={progress}
                className={cn("h-1.5 flex-1 bg-muted", progress === 100 && "[&>div]:bg-success")}
              />
              <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                {checklist.completed_items}/{checklist.total_items}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => setIsEditingTitle(true)}
              aria-label="Renomear template"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => deleteChecklist.mutate(checklist.id, { onSuccess: () => onDeleted?.() })}
              aria-label="Excluir template"
            >
              <Trash2 className="h-3.5 w-3.5" />
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
            <div className="border-t border-border/60 px-5 pb-5 pt-4">
              {checklist.description && (
                <p className="mb-3 text-[13px] text-muted-foreground">{checklist.description}</p>
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
              <div className="mt-3 flex items-center gap-2 rounded-2xl bg-sunken p-2">
                <Plus className="ml-1.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <Input
                  placeholder="Adicionar item..."
                  value={newItemTitle}
                  onChange={(e) => setNewItemTitle(e.target.value)}
                  onKeyDown={handleAddItemKeyDown}
                  className="h-9 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddItem}
                  disabled={!newItemTitle.trim()}
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
