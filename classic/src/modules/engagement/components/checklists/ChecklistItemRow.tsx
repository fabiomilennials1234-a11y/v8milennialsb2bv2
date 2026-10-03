import { memo, useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "@/modules/engagement/hooks/useChecklists";

interface ChecklistItemRowProps {
  item: ChecklistItem;
  onToggle: (id: string, completed: boolean) => void;
  onUpdate: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export const ChecklistItemRow = memo(function ChecklistItemRow({
  item,
  onToggle,
  onUpdate,
  onDelete,
}: ChecklistItemRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== item.title) {
      onUpdate(item.id, trimmed);
    } else {
      setEditTitle(item.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      setEditTitle(item.title);
      setIsEditing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className="flex items-center gap-3 py-2 px-1 group"
    >
      <Checkbox
        checked={item.is_completed}
        onCheckedChange={(checked) => onToggle(item.id, !!checked)}
        className="flex-shrink-0"
      />

      {isEditing ? (
        <Input
          ref={inputRef}
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="h-8 text-sm flex-1"
        />
      ) : (
        <span
          onClick={() => setIsEditing(true)}
          className={cn(
            "flex-1 text-sm cursor-pointer hover:text-primary transition-colors",
            item.is_completed && "line-through text-muted-foreground"
          )}
        >
          {item.title}
        </span>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(item.id);
        }}
      >
        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
      </Button>
    </motion.div>
  );
});
