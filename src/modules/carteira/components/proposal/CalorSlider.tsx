import { useState } from "react";
import { Flame } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CalorSliderProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function CalorSlider({ value, onChange, disabled }: CalorSliderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  const getCalorColor = (calor: number) => {
    if (calor >= 8) return "text-destructive";
    if (calor >= 5) return "text-chart-5";
    if (calor >= 3) return "text-chart-4";
    return "text-muted-foreground";
  };

  const getCalorBgColor = (calor: number) => {
    if (calor >= 8) return "bg-destructive/10";
    if (calor >= 5) return "bg-chart-5/10";
    if (calor >= 3) return "bg-chart-4/10";
    return "bg-muted";
  };

  const getCalorLabel = (calor: number) => {
    if (calor >= 9) return "Quente demais! 🔥";
    if (calor >= 7) return "Muito quente";
    if (calor >= 5) return "Morno";
    if (calor >= 3) return "Frio";
    return "Muito frio";
  };

  const handleSave = () => {
    onChange(localValue);
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          className={cn(
            "h-7 px-2 gap-1.5",
            getCalorBgColor(value),
            getCalorColor(value),
            "hover:opacity-80"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Flame className="w-3.5 h-3.5" />
          <span className="font-medium">{value}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className={cn("w-5 h-5", getCalorColor(localValue))} />
              <span className="font-medium">Calor do Lead</span>
            </div>
            <span
              className={cn(
                "text-2xl font-bold",
                getCalorColor(localValue)
              )}
            >
              {localValue}
            </span>
          </div>

          <div className="space-y-2">
            <Slider
              value={[localValue]}
              onValueChange={([v]) => setLocalValue(v)}
              max={10}
              min={0}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Frio</span>
              <span className={getCalorColor(localValue)}>
                {getCalorLabel(localValue)}
              </span>
              <span>Quente</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Probabilidade de fechar este mês. Leads com maior calor aparecem primeiro.
          </p>

          <Button className="w-full" onClick={handleSave}>
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Compact display for kanban cards
export function CalorBadge({ value }: { value: number }) {
  const getCalorColor = (calor: number) => {
    if (calor >= 8) return "text-destructive bg-destructive/10";
    if (calor >= 5) return "text-chart-5 bg-chart-5/10";
    if (calor >= 3) return "text-chart-4 bg-chart-4/10";
    return "text-muted-foreground bg-muted";
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium",
        getCalorColor(value)
      )}
    >
      <Flame className="w-3 h-3" />
      {value}
    </div>
  );
}
