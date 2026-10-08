import { memo, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInlineEdit } from "../../hooks/useInlineEdit";

interface InfoFieldRowProps {
  label: string;
  value: string | null | undefined;
  onSave?: (newValue: string) => Promise<void> | void;
  placeholder?: React.ReactNode;
  type?: "text" | "textarea";
  readOnly?: boolean;
  icon?: React.ReactNode;
  render?: (value: string) => React.ReactNode;
}

export const InfoFieldRow = memo(function InfoFieldRow({
  label,
  value,
  onSave,
  placeholder = "—",
  type = "text",
  readOnly = false,
  icon,
  render,
}: InfoFieldRowProps) {
  const editable = !readOnly && !!onSave;
  const edit = useInlineEdit({
    value: value ?? "",
    onSave: async (v) => { if (onSave) await onSave(v); },
  });
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (edit.isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [edit.isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && type !== "textarea") edit.commit();
    if (e.key === "Escape") edit.cancel();
  };

  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3 py-2 group">
      <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground/70 font-medium">
        {icon && <span className="opacity-60">{icon}</span>}
        <span>{label}</span>
      </div>
      <div className="min-w-0">
        {!editable ? (
          <div className="text-sm text-foreground/90 break-words">
            {value
              ? render
                ? render(value)
                : value
              : <span className="text-muted-foreground/40 italic">{placeholder}</span>}
          </div>
        ) : edit.isEditing ? (
          <div className="relative">
            {type === "textarea" ? (
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={edit.localValue}
                onChange={(e) => edit.setLocalValue(e.target.value)}
                onBlur={edit.commit}
                onKeyDown={handleKeyDown}
                rows={3}
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 resize-y"
              />
            ) : (
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                value={edit.localValue}
                onChange={(e) => edit.setLocalValue(e.target.value)}
                onBlur={edit.commit}
                onKeyDown={handleKeyDown}
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            )}
            {edit.isSaving && (
              <Loader2 className="absolute right-2 top-2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={edit.startEditing}
            className={cn(
              "w-full text-left text-sm px-2 py-1.5 rounded-md transition-colors -mx-2",
              "border border-transparent hover:border-border/40 hover:bg-muted/30",
              edit.localValue ? "text-foreground/90" : "text-muted-foreground/40 italic"
            )}
          >
            {edit.localValue
              ? render
                ? render(edit.localValue)
                : edit.localValue
              : placeholder}
          </button>
        )}
      </div>
    </div>
  );
});
