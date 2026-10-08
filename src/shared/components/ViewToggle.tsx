import { memo } from "react";
import { LayoutGrid, List, BarChart3, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ViewMode = "board" | "table" | "analytics" | "timeline";

interface ViewToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  options?: ViewMode[];
}

const VIEW_ICONS: Record<ViewMode, React.ElementType> = {
  board: LayoutGrid,
  table: List,
  analytics: BarChart3,
  timeline: CalendarDays,
};

const VIEW_LABELS: Record<ViewMode, string> = {
  board: "Kanban",
  table: "Lista",
  analytics: "Analytics",
  timeline: "Timeline",
};

export const ViewToggle = memo(function ViewToggle({
  value,
  onChange,
  options = ["board", "table"],
}: ViewToggleProps) {
  return (
    // V5: alternador segmentado (fundo `muted`, ativo sobe para o cartão).
    <div className="inline-flex items-center gap-0.5 rounded-full bg-muted p-[3px]">
      {options.map((mode) => {
        const Icon = VIEW_ICONS[mode];
        return (
          <Button
            key={mode}
            variant="ghost"
            size="sm"
            onClick={() => onChange(mode)}
            title={VIEW_LABELS[mode]}
            aria-label={VIEW_LABELS[mode]}
            aria-pressed={value === mode}
            className={cn(
              "h-8 gap-1.5 rounded-full px-3 text-muted-foreground hover:bg-transparent hover:text-foreground",
              value === mode && "bg-card text-foreground shadow-relevo hover:bg-card",
            )}
          >
            <Icon className="h-4 w-4" />
          </Button>
        );
      })}
    </div>
  );
});
