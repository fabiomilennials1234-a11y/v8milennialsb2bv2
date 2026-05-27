/**
 * MobileChatListHeader — WhatsApp-style compact 2-row header for mobile chat list.
 *
 * Row 1: Instance pill (colored dot + name + chevron) + search toggle/input.
 * Row 2: Horizontal scrollable filter chips (Todas, Não lidas, Grupos).
 *
 * Controlled component — all state from props. Instance selector UI handled by parent.
 */
import { useRef, useState, useEffect } from "react";
import { Search, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MobileChatFilter = "all" | "unread" | "groups";

export interface MobileChatListHeaderProps {
  instanceName: string;
  instanceConnected?: boolean;
  onOpenInstanceSelector: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeFilter: MobileChatFilter;
  onFilterChange: (filter: MobileChatFilter) => void;
  unreadCount: number;
}

// ─── Filter chip config ──────────────────────────────────────────────────────

interface ChipDef {
  key: MobileChatFilter;
  label: string;
  /** Append count in parens when > 0 */
  count?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MobileChatListHeader({
  instanceName,
  instanceConnected = false,
  onOpenInstanceSelector,
  searchQuery,
  onSearchChange,
  activeFilter,
  onFilterChange,
  unreadCount,
}: MobileChatListHeaderProps) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus search input when expanded
  useEffect(() => {
    if (searchExpanded) {
      // RAF ensures DOM has rendered the input before focusing
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [searchExpanded]);

  const handleCollapseSearch = () => {
    setSearchExpanded(false);
    onSearchChange("");
  };

  const chips: ChipDef[] = [
    { key: "all", label: "Todas" },
    { key: "unread", label: "Não lidas", count: unreadCount },
    { key: "groups", label: "Grupos" },
  ];

  return (
    <div className="bg-background border-b border-border/30 shrink-0">
      {/* ── Row 1: Instance pill + Search ──────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        {searchExpanded ? (
          /* Search expanded: back arrow + input + clear */
          <div className="flex items-center gap-2 w-full transition-all duration-200">
            <button
              type="button"
              onClick={handleCollapseSearch}
              className="shrink-0 p-1.5 -ml-1 rounded-full text-muted-foreground active:bg-muted/60"
              aria-label="Fechar busca"
            >
              <X className="w-5 h-5" />
            </button>

            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar conversa..."
              className="flex-1 bg-muted/50 rounded-full px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none ring-0 border-0"
            />

            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="shrink-0 p-1.5 rounded-full text-muted-foreground active:bg-muted/60"
                aria-label="Limpar busca"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          /* Default: instance pill + search icon */
          <>
            <button
              type="button"
              onClick={onOpenInstanceSelector}
              className="flex items-center gap-2 rounded-full border border-border/40 px-3 py-1.5 text-sm font-medium text-foreground active:bg-muted/60 transition-colors min-w-0"
            >
              <span
                className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  instanceConnected ? "bg-emerald-500" : "bg-red-500",
                )}
              />
              <span className="truncate max-w-[160px]">{instanceName}</span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            </button>

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => setSearchExpanded(true)}
              className="p-2 rounded-full text-muted-foreground active:bg-muted/60 transition-colors"
              aria-label="Buscar"
            >
              <Search className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* ── Row 2: Filter chips (horizontal scroll) ────────────────────────── */}
      <div className="flex gap-2 px-3 pt-1 pb-2 overflow-x-auto scrollbar-none">
        {chips.map((chip) => {
          const isActive = activeFilter === chip.key;
          const showCount = chip.count != null && chip.count > 0;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => onFilterChange(chip.key)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                isActive
                  ? "bg-[hsl(47_100%_50%)]/10 text-[hsl(47_100%_50%)] border-[hsl(47_100%_50%)]/30"
                  : "border-border/40 text-muted-foreground active:bg-muted/60",
              )}
            >
              {chip.label}
              {showCount && ` (${chip.count})`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
