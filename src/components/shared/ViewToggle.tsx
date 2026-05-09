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
    <div className="flex items-center border rounded-lg p-1">
      {options.map((mode) => {
        const Icon = VIEW_ICONS[mode];
        return (
          <Button
            key={mode}
            variant={value === mode ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onChange(mode)}
            title={VIEW_LABELS[mode]}
            className={cn("gap-1.5", value === mode && "shadow-sm")}
          >
            <Icon className="w-4 h-4" />
          </Button>
        );
      })}
    </div>
  );
});
