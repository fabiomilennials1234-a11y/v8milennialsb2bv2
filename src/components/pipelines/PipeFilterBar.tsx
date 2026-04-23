import { useState, type ReactNode } from "react";
import { Search, X, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface FilterChip {
  id: string;
  icon?: LucideIcon;
  label: string;
  /** Currently selected value label for display (null = inactive) */
  activeLabel?: string | null;
  /** Content rendered inside the popover/sheet when opened */
  renderControl: () => ReactNode;
  /** Called when user clicks the "x" to clear this filter */
  onClear?: () => void;
}

export interface PipeFilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /** Primary filters shown inline */
  primaryFilters?: FilterChip[];
  /** Secondary filters shown inside the "Mais filtros" sheet */
  secondaryFilters?: FilterChip[];
  /** Additional inline buttons (e.g. toggle) */
  extraActions?: ReactNode;
  /** Count of currently active filters (for badge on sheet trigger) */
  activeFiltersCount?: number;
  /** Called when user clears all filters */
  onClearAll?: () => void;
}

export function PipeFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Buscar lead, empresa, telefone...",
  primaryFilters = [],
  secondaryFilters = [],
  extraActions,
  activeFiltersCount = 0,
  onClearAll,
}: PipeFilterBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
      {/* Search */}
      <div className="relative flex-1 min-w-[260px] max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
        <Input
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10 pr-3 h-10 text-[13px] bg-card border-border/70 focus-visible:border-primary/40 focus-visible:ring-0"
        />
        {searchValue && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Inline primary filters as chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {primaryFilters.map((chip) => {
          const active = !!chip.activeLabel;
          return (
            <div
              key={chip.id}
              className={cn("filter-chip", active && "filter-chip-active")}
            >
              {chip.renderControl()}
              {active && chip.onClear && (
                <button
                  onClick={chip.onClear}
                  className="opacity-70 hover:opacity-100"
                  aria-label={`Limpar filtro ${chip.label}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {extraActions}

        {/* "Mais filtros" sheet trigger */}
        {secondaryFilters.length > 0 && (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button className="filter-chip relative">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Mais filtros
                {activeFiltersCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shadow-[0_0_12px_hsl(var(--primary)/0.5)]">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader className="mb-4">
                <SheetTitle>Filtros avançados</SheetTitle>
              </SheetHeader>
              <div className="space-y-4">
                {secondaryFilters.map((chip) => (
                  <div key={chip.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium flex items-center gap-2">
                        {chip.icon && <chip.icon className="w-3.5 h-3.5 text-muted-foreground" />}
                        {chip.label}
                      </label>
                      {chip.activeLabel && chip.onClear && (
                        <button
                          onClick={chip.onClear}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                    {chip.renderControl()}
                  </div>
                ))}
                {onClearAll && activeFiltersCount > 0 && (
                  <Button variant="outline" className="w-full mt-6" onClick={onClearAll}>
                    Limpar todos os filtros
                  </Button>
                )}
              </div>
            </SheetContent>
          </Sheet>
        )}

        {/* Clear-all inline */}
        {onClearAll && activeFiltersCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs text-muted-foreground hover:text-foreground gap-1"
            onClick={onClearAll}
          >
            <X className="w-3 h-3" />
            Limpar
          </Button>
        )}
      </div>
    </div>
  );
}
