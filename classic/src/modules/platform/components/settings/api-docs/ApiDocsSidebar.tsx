import { useState } from "react";
import { ChevronDown, ChevronRight, Webhook, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MethodBadge } from "./MethodBadge";
import type { ApiCategory } from "@/lib/api-docs/types";

interface ApiDocsSidebarProps {
  categories: ApiCategory[];
  selectedEndpointId: string;
  onSelect: (endpointId: string) => void;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  webhook: <Webhook className="w-4 h-4" />,
};

export function ApiDocsSidebar({ categories, selectedEndpointId, onSelect }: ApiDocsSidebarProps) {
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(categories.map((c) => c.id)),
  );

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = categories
    .map((cat) => ({
      ...cat,
      endpoints: cat.endpoints.filter(
        (ep) =>
          !search ||
          ep.name.toLowerCase().includes(search.toLowerCase()) ||
          ep.path.toLowerCase().includes(search.toLowerCase()),
      ),
    }))
    .filter((cat) => cat.endpoints.length > 0);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar endpoint..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm bg-muted/30"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {filtered.map((category) => (
          <div key={category.id} className="mb-1">
            <button
              onClick={() => toggleCategory(category.id)}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              {expandedCategories.has(category.id) ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              {CATEGORY_ICONS[category.icon] || <Webhook className="w-4 h-4" />}
              <span className="flex-1 text-left">{category.name}</span>
              <span className="text-[10px] text-muted-foreground/60 font-normal">
                {category.endpoints.length}
              </span>
            </button>

            {expandedCategories.has(category.id) && (
              <div className="ml-2">
                {category.endpoints.map((endpoint) => (
                  <button
                    key={endpoint.id}
                    onClick={() => onSelect(endpoint.id)}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-all",
                      selectedEndpointId === endpoint.id
                        ? "bg-primary/10 text-foreground border-l-2 border-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
                      endpoint.deprecated && "opacity-60",
                    )}
                  >
                    <MethodBadge method={endpoint.method} className="text-[9px] px-1.5 py-0" />
                    <span className="truncate text-left text-[13px]">{endpoint.name}</span>
                    {endpoint.deprecated && (
                      <span className="text-amber-500 text-[10px] ml-auto">obsoleto</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}
