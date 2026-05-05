import { useState } from "react";
import {
  Filter,
  User,
  Tag,
  Flame,
  Star,
  Clock,
  Package,
  Globe,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// ─── Origin labels ──────────────────────────────────────────────────────────
const originLabels: Record<string, { label: string; color: string }> = {
  whatsapp: { label: "WhatsApp", color: "bg-green-500" },
  meta_ads: { label: "Meta Ads", color: "bg-purple-500" },
  instagram: { label: "Instagram", color: "bg-pink-500" },
  tiktok: { label: "Tiktok", color: "bg-foreground/15" },
  google_ads: { label: "Google Ads", color: "bg-red-500" },
  site: { label: "Site", color: "bg-teal-500" },
  landing_page: { label: "Landing Page", color: "bg-sky-500" },
  remarketing: { label: "Remarketing", color: "bg-orange-500" },
  indicacao: { label: "Indicação", color: "bg-emerald-500" },
  evento: { label: "Evento", color: "bg-violet-500" },
  prospeccao_ativa: { label: "Prospecção Ativa", color: "bg-orange-600" },
  cal: { label: "Cal.com", color: "bg-blue-600" },
  outro: { label: "Outros", color: "bg-muted-foreground/15" },
};

const ALL_ORIGIN_OPTIONS = [
  "whatsapp",
  "meta_ads",
  "instagram",
  "tiktok",
  "google_ads",
  "site",
  "landing_page",
  "remarketing",
  "indicacao",
  "evento",
  "prospeccao_ativa",
  "cal",
  "outro",
];

// ─── Types ──────────────────────────────────────────────────────────────────
export interface KanbanFilterPanelFilters {
  filterResponsible: string;
  filterProductType: string;
  filterPriority: string;
  filterCalor: string;
  filterOrigin: string[];
  filterTags: string[];
  filterScheduled: boolean;
}

interface ResponsibleMember {
  id: string;
  name: string;
}

interface OrgTag {
  id: string;
  name: string;
  color: string | null;
}

interface KanbanFilterPanelProps {
  filters: KanbanFilterPanelFilters;
  onFilterChange: <K extends keyof KanbanFilterPanelFilters>(
    key: K,
    value: KanbanFilterPanelFilters[K]
  ) => void;
  onClearAll: () => void;
  responsibleMembers: ResponsibleMember[];
  orgTags: OrgTag[];
}

// ─── Helper: count active filters ──────────────────────────────────────────
export function countActiveFilters(filters: KanbanFilterPanelFilters): number {
  let count = 0;
  if (filters.filterResponsible !== "all") count++;
  if (filters.filterProductType !== "all") count++;
  if (filters.filterPriority !== "all") count++;
  if (filters.filterCalor !== "all") count++;
  if (filters.filterOrigin.length > 0) count++;
  if (filters.filterTags.length > 0) count++;
  if (filters.filterScheduled) count++;
  return count;
}

// ─── Helper: get filter chip labels ─────────────────────────────────────────
export function getActiveFilterChips(
  filters: KanbanFilterPanelFilters,
  responsibleMembers: ResponsibleMember[],
  orgTags: OrgTag[]
): Array<{ key: keyof KanbanFilterPanelFilters; label: string; removeValue: any }> {
  const chips: Array<{ key: keyof KanbanFilterPanelFilters; label: string; removeValue: any }> = [];

  if (filters.filterResponsible !== "all") {
    const member = responsibleMembers.find((m) => m.id === filters.filterResponsible);
    chips.push({
      key: "filterResponsible",
      label: `Responsável: ${member?.name || "..."}`,
      removeValue: "all",
    });
  }

  if (filters.filterProductType !== "all") {
    const typeLabel = filters.filterProductType === "mrr" ? "Recorrência" : "Projeto";
    chips.push({
      key: "filterProductType",
      label: `Tipo: ${typeLabel}`,
      removeValue: "all",
    });
  }

  if (filters.filterCalor !== "all") {
    const calorLabel =
      filters.filterCalor === "hot" ? "Quente" : filters.filterCalor === "warm" ? "Morno" : "Frio";
    chips.push({
      key: "filterCalor",
      label: `Calor: ${calorLabel}`,
      removeValue: "all",
    });
  }

  if (filters.filterPriority !== "all") {
    const prioLabel =
      filters.filterPriority === "high"
        ? "Alta"
        : filters.filterPriority === "medium"
          ? "Média"
          : "Baixa";
    chips.push({
      key: "filterPriority",
      label: `Prioridade: ${prioLabel}`,
      removeValue: "all",
    });
  }

  if (filters.filterOrigin.length > 0) {
    const labels = filters.filterOrigin
      .map((o) => originLabels[o]?.label || o)
      .slice(0, 2)
      .join(", ");
    const suffix = filters.filterOrigin.length > 2 ? ` +${filters.filterOrigin.length - 2}` : "";
    chips.push({
      key: "filterOrigin",
      label: `Origem: ${labels}${suffix}`,
      removeValue: [] as string[],
    });
  }

  if (filters.filterTags.length > 0) {
    const labels = filters.filterTags
      .map((id) => orgTags.find((t) => t.id === id)?.name || "...")
      .slice(0, 2)
      .join(", ");
    const suffix = filters.filterTags.length > 2 ? ` +${filters.filterTags.length - 2}` : "";
    chips.push({
      key: "filterTags",
      label: `Tags: ${labels}${suffix}`,
      removeValue: [] as string[],
    });
  }

  if (filters.filterScheduled) {
    chips.push({
      key: "filterScheduled",
      label: "Agendados",
      removeValue: false,
    });
  }

  return chips;
}

// ─── Component ──────────────────────────────────────────────────────────────
export function KanbanFilterPanel({
  filters,
  onFilterChange,
  onClearAll,
  responsibleMembers,
  orgTags,
}: KanbanFilterPanelProps) {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveFilters(filters);

  return (
    <>
      {/* Trigger Button */}
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "gap-2 relative transition-all",
          activeCount > 0 && "border-primary/50 bg-primary/5 text-primary hover:bg-primary/10"
        )}
        onClick={() => setOpen(true)}
      >
        <Filter className="w-4 h-4" />
        Filtros
        {activeCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow-sm">
            {activeCount}
          </span>
        )}
      </Button>

      {/* Sheet Panel */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-[380px] sm:max-w-[380px] p-0 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <SheetHeader className="flex-row items-center gap-3 space-y-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Filter className="h-4 w-4 text-primary" />
              </div>
              <div>
                <SheetTitle className="text-base">Filtros</SheetTitle>
                <SheetDescription className="text-xs">
                  {activeCount > 0
                    ? `${activeCount} filtro${activeCount > 1 ? "s" : ""} ativo${activeCount > 1 ? "s" : ""}`
                    : "Nenhum filtro aplicado"}
                </SheetDescription>
              </div>
            </SheetHeader>
            {activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={() => {
                  onClearAll();
                }}
              >
                Limpar tudo
              </Button>
            )}
          </div>

          {/* Filter Sections */}
          <ScrollArea className="flex-1 px-6 py-4">
            <div className="space-y-6">
              {/* Responsável */}
              <FilterSection icon={User} label="Responsável">
                <Select
                  value={filters.filterResponsible}
                  onValueChange={(v) => onFilterChange("filterResponsible", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Todos os responsáveis" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os responsáveis</SelectItem>
                    {responsibleMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterSection>

              <Separator className="bg-border/50" />

              {/* Origem (multi-select) */}
              <FilterSection icon={Globe} label="Origem">
                <div className="grid grid-cols-1 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                  {ALL_ORIGIN_OPTIONS.map((origin) => {
                    const meta = originLabels[origin];
                    const checked = filters.filterOrigin.includes(origin);
                    return (
                      <label
                        key={origin}
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors",
                          "hover:bg-muted/50",
                          checked && "bg-primary/5"
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) => {
                            const next = c
                              ? [...filters.filterOrigin, origin]
                              : filters.filterOrigin.filter((o) => o !== origin);
                            onFilterChange("filterOrigin", next);
                          }}
                          className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                        <span
                          className={cn("h-2 w-2 rounded-full shrink-0", meta.color)}
                        />
                        <span className="text-sm">{meta.label}</span>
                      </label>
                    );
                  })}
                </div>
              </FilterSection>

              <Separator className="bg-border/50" />

              {/* Tags (multi-select) */}
              <FilterSection icon={Tag} label="Tags">
                {orgTags.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    Nenhuma tag cadastrada
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                    {orgTags.map((tag) => {
                      const checked = filters.filterTags.includes(tag.id);
                      return (
                        <label
                          key={tag.id}
                          className={cn(
                            "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors",
                            "hover:bg-muted/50",
                            checked && "bg-primary/5"
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => {
                              const next = c
                                ? [...filters.filterTags, tag.id]
                                : filters.filterTags.filter((id) => id !== tag.id);
                              onFilterChange("filterTags", next);
                            }}
                            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          />
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: tag.color || "#888" }}
                          />
                          <span className="text-sm">{tag.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </FilterSection>

              <Separator className="bg-border/50" />

              {/* Tipo Produto */}
              <FilterSection icon={Package} label="Tipo Produto">
                <Select
                  value={filters.filterProductType}
                  onValueChange={(v) => onFilterChange("filterProductType", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Todos os tipos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="mrr">Recorrência</SelectItem>
                    <SelectItem value="projeto">Projeto</SelectItem>
                  </SelectContent>
                </Select>
              </FilterSection>

              <Separator className="bg-border/50" />

              {/* Calor */}
              <FilterSection icon={Flame} label="Calor">
                <Select
                  value={filters.filterCalor}
                  onValueChange={(v) => onFilterChange("filterCalor", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="hot">
                      <div className="flex items-center gap-2">
                        <Flame className="w-3 h-3 text-destructive" />
                        Quente (7-10)
                      </div>
                    </SelectItem>
                    <SelectItem value="warm">
                      <div className="flex items-center gap-2">
                        <Flame className="w-3 h-3 text-chart-5" />
                        Morno (4-6)
                      </div>
                    </SelectItem>
                    <SelectItem value="cold">
                      <div className="flex items-center gap-2">
                        <Flame className="w-3 h-3 text-muted-foreground" />
                        Frio (0-3)
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FilterSection>

              <Separator className="bg-border/50" />

              {/* Prioridade */}
              <FilterSection icon={Star} label="Prioridade">
                <Select
                  value={filters.filterPriority}
                  onValueChange={(v) => onFilterChange("filterPriority", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as prioridades</SelectItem>
                    <SelectItem value="high">
                      <div className="flex items-center gap-2">
                        <span className="text-chart-5">★★★</span>
                        Alta (8-10)
                      </div>
                    </SelectItem>
                    <SelectItem value="medium">
                      <div className="flex items-center gap-2">
                        <span className="text-chart-5">★★</span>
                        Média (5-7)
                      </div>
                    </SelectItem>
                    <SelectItem value="low">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">★</span>
                        Baixa (0-4)
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FilterSection>

              <Separator className="bg-border/50" />

              {/* Agendados */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Agendados</span>
                </div>
                <Switch
                  checked={filters.filterScheduled}
                  onCheckedChange={(v) => onFilterChange("filterScheduled", v)}
                />
              </div>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Sub-component: section wrapper ─────────────────────────────────────────
function FilterSection({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      {children}
    </div>
  );
}

// ─── Filter Chips (inline below search) ─────────────────────────────────────
export function FilterChips({
  filters,
  onFilterChange,
  onClearAll,
  responsibleMembers,
  orgTags,
}: {
  filters: KanbanFilterPanelFilters;
  onFilterChange: <K extends keyof KanbanFilterPanelFilters>(
    key: K,
    value: KanbanFilterPanelFilters[K]
  ) => void;
  onClearAll: () => void;
  responsibleMembers: ResponsibleMember[];
  orgTags: OrgTag[];
}) {
  const chips = getActiveFilterChips(filters, responsibleMembers, orgTags);
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Badge
          key={chip.key}
          variant="secondary"
          className="gap-1 pl-2.5 pr-1.5 py-0.5 text-xs font-normal bg-muted/60 hover:bg-muted cursor-pointer group transition-colors"
          onClick={() => onFilterChange(chip.key, chip.removeValue)}
        >
          {chip.label}
          <X className="w-3 h-3 text-muted-foreground group-hover:text-destructive transition-colors" />
        </Badge>
      ))}
      {chips.length > 1 && (
        <button
          onClick={onClearAll}
          className="text-[11px] text-muted-foreground hover:text-destructive transition-colors ml-1"
        >
          Limpar tudo
        </button>
      )}
    </div>
  );
}
