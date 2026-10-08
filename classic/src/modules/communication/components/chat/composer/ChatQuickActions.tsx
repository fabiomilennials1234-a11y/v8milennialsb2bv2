/**
 * ChatQuickActions — barra horizontal de ações rápidas acima do composer.
 *
 * 3 botões: Gravar áudio, Template rápido, Anexar arquivo.
 * Touch targets: min 44x44px. Dark-first, muted icons, brighter on hover.
 */
import { Mic, FileText, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatQuickActionsProps {
  onAudio: () => void;
  onTemplate: () => void;
  onAttach: () => void;
  disabled?: boolean;
}

export function ChatQuickActions({
  onAudio,
  onTemplate,
  onAttach,
  disabled = false,
}: ChatQuickActionsProps) {
  const btnBase = cn(
    "inline-flex items-center justify-center rounded-md",
    "min-w-[44px] min-h-[44px]",
    "text-muted-foreground transition-colors",
    "hover:text-foreground hover:bg-muted/60",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
    "disabled:opacity-40 disabled:pointer-events-none",
  );

  return (
    <div
      className="flex items-center gap-1 px-1 pb-1.5 border-b border-border/40"
      role="toolbar"
      aria-label="Ações rápidas"
    >
      <button
        type="button"
        onClick={onAudio}
        disabled={disabled}
        aria-label="Gravar áudio"
        className={btnBase}
      >
        <Mic className="w-[18px] h-[18px]" />
      </button>

      <button
        type="button"
        onClick={onTemplate}
        disabled={disabled}
        aria-label="Template rápido"
        className={btnBase}
      >
        <FileText className="w-[18px] h-[18px]" />
      </button>

      <button
        type="button"
        onClick={onAttach}
        disabled={disabled}
        aria-label="Anexar arquivo"
        className={btnBase}
      >
        <Paperclip className="w-[18px] h-[18px]" />
      </button>
    </div>
  );
}
