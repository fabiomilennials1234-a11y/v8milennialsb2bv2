/**
 * MenuPreview — renderiza preview visual do menu WhatsApp.
 *
 * Cada tipo de menu tem estética distinta:
 *  - button: pills empilhadas
 *  - list: rows com chevron
 *  - poll: radio circles
 *  - carousel: cards horizontal scroll (simplificado em preview)
 */
import { Circle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  type: "button" | "list" | "poll" | "carousel";
  text: string;
  choices: string[];
  footer?: string;
}

export function MenuPreview({ type, text, choices, footer }: Props) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-3 max-w-xs">
      <div className="bg-card rounded-md border border-border/40 px-3 py-2 space-y-2">
        {text && (
          <p className="text-sm whitespace-pre-wrap break-words">{text}</p>
        )}

        {choices.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            Adicione ao menos 1 opção
          </p>
        ) : (
          <div
            className={cn(
              "space-y-1 pt-1",
              type === "carousel" && "flex gap-1 overflow-x-auto space-y-0"
            )}
          >
            {choices.map((choice, idx) => (
              <div
                key={idx}
                className={cn(
                  "text-xs rounded border border-border/40 px-2 py-1.5 flex items-center gap-2",
                  type === "button" && "justify-center text-primary font-medium",
                  type === "list" && "justify-between",
                  type === "poll" && "text-foreground/90",
                  type === "carousel" && "min-w-[100px] justify-center"
                )}
              >
                {type === "poll" && <Circle className="h-3 w-3 flex-shrink-0" />}
                <span className="truncate">{choice}</span>
                {type === "list" && (
                  <ChevronRight className="h-3 w-3 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}

        {footer && (
          <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40 mt-2">
            {footer}
          </p>
        )}
      </div>
    </div>
  );
}
