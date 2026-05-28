import { memo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Color stripes top do card — estilo Trello.
 *
 * Mostra até 3 stripes coloridos das tags do lead + counter "+N" se houver
 * mais. Tooltip on hover lista todos os nomes.
 */
interface Tag {
  name: string;
  color: string;
}

interface LeadCardLabelsProps {
  tags?: Tag[] | null;
  className?: string;
}

const MAX_VISIBLE = 3;

export const LeadCardLabels = memo(function LeadCardLabels({ tags, className }: LeadCardLabelsProps) {
  if (!tags || tags.length === 0) return null;
  const visible = tags.slice(0, MAX_VISIBLE);
  const extra = tags.length - visible.length;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("flex items-center gap-1 px-3 pt-2.5", className)}>
        {visible.map((tag, i) => (
          <Tooltip key={`${tag.name}-${i}`}>
            <TooltipTrigger asChild>
              <div
                className="h-1.5 w-9 rounded-full transition-all hover:h-2 cursor-default"
                style={{ backgroundColor: tag.color || "#888" }}
                aria-label={tag.name}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              {tag.name}
            </TooltipContent>
          </Tooltip>
        ))}
        {extra > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[9px] font-semibold text-muted-foreground/70 ml-0.5 px-1 py-px rounded bg-muted/40">
                +{extra}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              {tags.slice(MAX_VISIBLE).map((t) => t.name).join(" · ")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
});
