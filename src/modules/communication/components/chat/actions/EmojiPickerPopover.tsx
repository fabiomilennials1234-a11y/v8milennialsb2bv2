import { lazy, Suspense, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Plus, Smile } from "lucide-react";
import { cn } from "@/lib/utils";

// Download the localized catalog only when the full picker is opened.
const EmojiPickerPanel = lazy(() => import("./EmojiPickerPanel"));
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

interface Props {
  onSelect: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
  mode?: "reaction" | "compose";
  onCloseAutoFocus?: (event: Event) => void;
}

export function EmojiPickerPopover({ onSelect, disabled, className, mode = "reaction", onCloseAutoFocus }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const fullPicker = mode === "compose" || expanded;
  const select = (emoji: string) => {
    if (disabled) return;
    onSelect(emoji);
    setOpen(false);
  };

  return (
    <Popover open={open && !disabled} onOpenChange={(next) => { setOpen(next); if (next) setExpanded(false); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={mode === "compose" ? "Inserir emoji" : "Reagir com emoji"}
          title={mode === "compose" ? "Inserir emoji" : "Reagir com emoji"}
          className={cn(mode === "compose" ? "h-10 w-10 shrink-0 text-muted-foreground" : "h-7 w-7", className)}
        >
          <Smile className="h-[18px] w-[18px]" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align={mode === "compose" ? "start" : "center"}
        collisionPadding={12}
        aria-label={mode === "compose" ? "Escolher emoji" : "Escolher reação"}
        className={fullPicker ? "w-[360px] max-w-[calc(100vw-24px)] p-0" : "flex w-auto items-center gap-1 p-2"}
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {fullPicker ? (
          <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Carregando emojis...</p>}>
            <EmojiPickerPanel onSelect={select} />
          </Suspense>
        ) : (
          <>
            {QUICK_EMOJIS.map((emoji) => (
              <button key={emoji} type="button" onClick={() => select(emoji)} aria-label={`Reagir com ${emoji}`} className="h-9 w-9 rounded-lg text-xl transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {emoji}
              </button>
            ))}
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Mais emojis" onClick={() => setExpanded(true)}>
              <Plus className="h-4 w-4" aria-hidden />
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
