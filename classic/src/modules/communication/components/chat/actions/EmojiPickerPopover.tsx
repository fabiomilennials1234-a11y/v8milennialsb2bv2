/**
 * EmojiPickerPopover — 6 emoji quick picks + expand.
 *
 * Props:
 *  - onSelect(emoji) — chamado quando user escolhe
 *  - disabled — desabilita trigger (usado durante isPending mutation)
 */
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

interface Props {
  onSelect: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
}

export function EmojiPickerPopover({ onSelect, disabled, className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Reagir com emoji"
          className={cn("h-7 w-7", className)}
        >
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="flex gap-1 p-2 w-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onSelect(emoji);
              setOpen(false);
            }}
            className="text-xl hover:scale-125 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            aria-label={`Reagir com ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
