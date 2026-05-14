import { useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInlineEdit } from "./hooks/useInlineEdit";

interface InlineFieldProps {
  label: string;
  value: string;
  onSave: (newValue: string) => Promise<void>;
  placeholder?: string;
  type?: "text" | "textarea";
}

export function InlineField({ label, value, onSave, placeholder = "—", type = "text" }: InlineFieldProps) {
  const { localValue, setLocalValue, isEditing, isSaving, startEditing, commit, cancel } = useInlineEdit({ value, onSave });
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && type !== "textarea") commit();
    if (e.key === "Escape") cancel();
  };

  return (
    <div className="flex items-center gap-2 py-[5px] group">
      <span className="text-[10px] text-muted-foreground/40 min-w-[70px] shrink-0">{label}</span>
      {isEditing ? (
        <div className="flex-1 relative">
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-[10px] text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          {isSaving && <Loader2 className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded text-left flex-1 min-w-0 truncate transition-colors",
            "border border-transparent hover:border-border/50 hover:bg-muted/30",
            localValue ? "text-foreground/70" : "text-muted-foreground/30 italic"
          )}
        >
          {localValue || placeholder}
        </button>
      )}
    </div>
  );
}
