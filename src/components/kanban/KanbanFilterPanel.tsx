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
  AlertTriangle,
  Columns3,
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

// ─── Origin labels (shared source of truth) ────��────────────────────────────
export const originLabels: Record<string, { label: string; color: string }> = {
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

export const ALL_ORIGIN_OPTIONS = [
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

// ─── Urgency options ─────────────────────────────────────────────────────────
const URGENCY_OPTIONS = [
  { value: "imediato", label: "Imediato" },
  { value: "1-mes", label: "1 mês" },
  { value: "2-3-meses", label: "2-3 meses" },
  { value: "6-meses", label: "6+ meses" },
];

// ─── Section types ───────────────────���──────────────────────────────���────────
export type FilterSectionConfig =
  | { type: "responsible"; value: string; onChange: (v: string) => void; members: { id: string; name: string }[] }
  | { type: "origin-single"; value: string; onChange: (v: string) => void }
  | { type: "origin-multi"; value: string[]; onChange: (v: string[]) => void }
  | { type: "tags"; value: string[]; onChange: (v: string[]) => void; tags: { id: string; name: string; color: string | null }[] }
  | { type: "product-type"; value: string; onChange: (v: string) => void }
  | { type: "calor"; value: string; onChange: (v: string) => void }
  | { type: "priority"; value: string; onChange: (v: string) => void }
  | { type: "urgency"; value: string; onChange: (v: string) => void }
  | { type: "status-multi"; value: string[]; onChange: (v: string[]) => void; options: { id: string; title: string; color: string }[] }
  | { type: "scheduled"; value: boolean; onChange: (v: boolean) => void };

export interface KanbanFilterPanelProps {
  sections: FilterSectionConfig[];
  onClearAll: () => void;
}

// ─── Helper: count active filters from sections ──────────────���───────────────
export function countActiveFilters(sections: FilterSectionConfig[]): number {
  let count = 0;
  for (const section of sections) {
    switch (section.type) {
      case "responsible":
      case "origin-single":
      case "product-type":
      case "calor":
      case "priority":
      case "urgency":
        if (section.value !== "all") count++;
        break;
      case "origin-multi":
      case "tags":
      case "status-multi":
        if (section.value.length > 0) count++;
        break;
      case "scheduled":
        if (section.value) count++;
        break;
    }
  }
  return count;
}

// ─── Helper: generate filter chips from sections ─────────────────────────────
export interface FilterChipData {
  id: string;
  label: string;
  onRemove: () => void;
}

export function getFilterChips(sections: FilterSectionConfig[]): FilterChipData[] {
  const chips: FilterChipData[] = [];

  for (const section of sections) {
    switch (section.type) {
      case "responsible": {
        if (section.value !== "all") {
          const member = section.members.find((m) => m.id === section.value);
          chips.push({
            id: "responsible",
            label: `Responsável: ${member?.name || "..."}`,
            onRemove: () => section.onChange("all"),
          });
        }
        break;
      }
      case "origin-single": {
        if (section.value !== "all") {
          chips.push({
            id: "origin-single",
            label: `Origem: ${originLabels[section.value]?.label || section.value}`,
            onRemove: () => section.onChange("all"),
          });
        }
        break;
      }
      case "origin-multi": {
        if (section.value.length > 0) {
          const labels = section.value
            .map((o) => originLabels[o]?.label || o)
            .slice(0, 2)
            .join(", ");
          const suffix = section.value.length > 2 ? ` +${section.value.length - 2}` : "";
          chips.push({
            id: "origin-multi",
            label: `Origem: ${labels}${suffix}`,
            onRemove: () => section.onChange([]),
          });
        }
        break;
      }
      case "tags": {
        if (section.value.length > 0) {
          const labels = section.value
            .map((id) => section.tags.find((t) => t.id === id)?.name || "...")
            .slice(0, 2)
            .join(", ");
          const suffix = section.value.length > 2 ? ` +${section.value.length - 2}` : "";
          chips.push({
            id: "tags",
            label: `Tags: ${labels}${suffix}`,
            onRemove: () => section.onChange([]),
          });
        }
        break;
      }
      case "product-type": {
        if (section.value !== "all") {
          const typeLabel = section.value === "mrr" ? "Recorrência" : "Projeto";
          chips.push({
            id: "product-type",
            label: `Tipo: ${typeLabel}`,
            onRemove: () => section.onChange("all"),
          });
        }
        break;
      }
      case "calor": {
        if (section.value !== "all") {
          const calorLabel = section.value === "hot" ? "Quente" : section.value === "warm" ? "Morno" : "Frio";
          chips.push({
            id: "calor",
            label: `Calor: ${calorLabel}`,
            onRemove: () => section.onChange("all"),
          });
        }
        break;
      }
      case "priority": {
        if (section.value !== "all") {
          const prioLabel = section.value === "high" ? "Alta" : section.value === "medium" ? "Média" : "Baixa";
          chips.push({
            id: "priority",
            label: `Prioridade: ${prioLabel}`,
            onRemove: () => section.onChange("all"),
          });
        }
        break;
      }
      case "urgency": {
        if (section.value !== "all") {
          const urgLabel = URGENCY_OPTIONS.find((o) => o.value === section.value)?.label || section.value;
          chips.push({
            id: "urgency",
            label: `Urgência: ${urgLabel}`,
            onRemove: () => section.onChange("all"),
          });
        }
        break;
      }
      case "status-multi": {
        if (section.value.length > 0) {
          const labels = section.value
            .map((id) => section.options.find((o) => o.id === id)?.title || "...")
            .slice(0, 2)
            .join(", ");
          const suffix = section.value.length > 2 ? ` +${section.value.length - 2}` : "";
          chips.push({
            id: "status-multi",
            label: `Status: ${labels}${suffix}`,
            onRemove: () => section.onChange([]),
          });
        }
        break;
      }
      case "scheduled": {
        if (section.value) {
          chips.push({
            id: "scheduled",
            label: "Agendados",
            onRemove: () => section.onChange(false),
          });
        }
        break;
      }
    }
  }

  return chips;
}

// ─── Component ───────────────────���──────────────────────────────────────────
export function KanbanFilterPanel({ sections, onClearAll }: KanbanFilterPanelProps) {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveFilters(sections);

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
      <Sheet open={open} onOpenChange={setOpen} modal={false}>
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
              {sections.map((section, idx) => (
                <div key={`${section.type}-${idx}`}>
                  {idx > 0 && <Separator className="bg-border/50 mb-6" />}
                  <SectionRenderer section={section} />
                </div>
              ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Section Renderer ────────────────���────────────────────────────────────────
function SectionRenderer({ section }: { section: FilterSectionConfig }) {
  switch (section.type) {
    case "responsible":
      return (
        <FilterSectionWrapper icon={User} label="Responsável">
          <Select value={section.value} onValueChange={section.onChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos os responsáveis" />
            </SelectTrigger>
            <SelectContent className="z-[60]">
              <SelectItem value="all">Todos os responsáveis</SelectItem>
              {section.members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSectionWrapper>
      );

    case "origin-single":
      return (
        <FilterSectionWrapper icon={Globe} label="Origem">
          <Select value={section.value} onValueChange={section.onChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todas as origens" />
            </SelectTrigger>
            <SelectContent className="z-[60]">
              <SelectItem value="all">Todas as origens</SelectItem>
              {ALL_ORIGIN_OPTIONS.map((origin) => {
                const meta = originLabels[origin];
                return (
                  <SelectItem key={origin} value={origin}>
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full shrink-0", meta.color)} />
                      {meta.label}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </FilterSectionWrapper>
      );

    case "origin-multi":
      return (
        <FilterSectionWrapper icon={Globe} label="Origem">
          <div className="grid grid-cols-1 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
            {ALL_ORIGIN_OPTIONS.map((origin) => {
              const meta = originLabels[origin];
              const checked = section.value.includes(origin);
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
                        ? [...section.value, origin]
                        : section.value.filter((o) => o !== origin);
                      section.onChange(next);
                    }}
                    className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span className={cn("h-2 w-2 rounded-full shrink-0", meta.color)} />
                  <span className="text-sm">{meta.label}</span>
                </label>
              );
            })}
          </div>
        </FilterSectionWrapper>
      );

    case "tags":
      return (
        <FilterSectionWrapper icon={Tag} label="Tags">
          {section.tags.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              Nenhuma tag cadastrada
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
              {section.tags.map((tag) => {
                const checked = section.value.includes(tag.id);
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
                          ? [...section.value, tag.id]
                          : section.value.filter((id) => id !== tag.id);
                        section.onChange(next);
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
        </FilterSectionWrapper>
      );

    case "product-type":
      return (
        <FilterSectionWrapper icon={Package} label="Tipo Produto">
          <Select value={section.value} onValueChange={section.onChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos os tipos" />
            </SelectTrigger>
            <SelectContent className="z-[60]">
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="mrr">Recorrência</SelectItem>
              <SelectItem value="projeto">Projeto</SelectItem>
            </SelectContent>
          </Select>
        </FilterSectionWrapper>
      );

    case "calor":
      return (
        <FilterSectionWrapper icon={Flame} label="Calor">
          <Select value={section.value} onValueChange={section.onChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent className="z-[60]">
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
        </FilterSectionWrapper>
      );

    case "priority":
      return (
        <FilterSectionWrapper icon={Star} label="Prioridade">
          <Select value={section.value} onValueChange={section.onChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent className="z-[60]">
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
        </FilterSectionWrapper>
      );

    case "urgency":
      return (
        <FilterSectionWrapper icon={AlertTriangle} label="Urgência">
          <Select value={section.value} onValueChange={section.onChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent className="z-[60]">
              <SelectItem value="all">Todas as urg��ncias</SelectItem>
              {URGENCY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSectionWrapper>
      );

    case "status-multi":
      return (
        <FilterSectionWrapper icon={Columns3} label="Status">
          <div className="grid grid-cols-1 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
            {section.options.map((status) => {
              const checked = section.value.includes(status.id);
              return (
                <label
                  key={status.id}
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
                        ? [...section.value, status.id]
                        : section.value.filter((id) => id !== status.id);
                      section.onChange(next);
                    }}
                    className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: status.color }}
                  />
                  <span className="text-sm">{status.title}</span>
                </label>
              );
            })}
          </div>
        </FilterSectionWrapper>
      );

    case "scheduled":
      return (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Agendados</span>
          </div>
          <Switch
            checked={section.value}
            onCheckedChange={section.onChange}
          />
        </div>
      );
  }
}

// ─── Sub-component: section wrapper ─────────────────────────────────────────
function FilterSectionWrapper({
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

// ─── Filter Chips (inline below search) ─────────���───────────────────────────
export function FilterChips({
  sections,
  onClearAll,
}: {
  sections: FilterSectionConfig[];
  onClearAll: () => void;
}) {
  const chips = getFilterChips(sections);
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Badge
          key={chip.id}
          variant="secondary"
          className="gap-1 pl-2.5 pr-1.5 py-0.5 text-xs font-normal bg-muted/60 hover:bg-muted cursor-pointer group transition-colors"
          onClick={chip.onRemove}
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
