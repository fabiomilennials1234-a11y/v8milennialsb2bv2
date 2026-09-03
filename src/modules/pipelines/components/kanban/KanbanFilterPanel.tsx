import { useState } from "react";
import {
  Filter,
  User,
  Tag,
  Clock,
  Package,
  Globe,
  X,
  AlertTriangle,
  Columns3,
  Gem,
  Sparkles,
  CalendarRange,
  Hourglass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  QUALIFICATION_TIERS,
  QUALIFICATION_TIER_CONFIG,
  type QualificationTier,
} from "@/modules/leads";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange as RDPDateRange } from "react-day-picker";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  applyPeriodShortcut,
  createInitialPeriodState,
  getDateRange,
  matchPeriodShortcut,
  revivePeriodState,
  type MetricsPeriodState,
  type PeriodShortcut,
} from "@/lib/metrics-period";
import {
  STALLED_ALL,
  STALLED_BUCKETS,
  stalledBucketLabel,
} from "@/modules/pipelines/lib/stalled-buckets";
import { cn } from "@/lib/utils";
import {
  countActiveFilters,
  type FilterSectionConfig,
} from "@/modules/pipelines/lib/kanban-filter-config";
// FilterSectionConfig e countActiveFilters vivem em `lib/kanban-filter-config`
// para que o hook que MONTA a config não precise importar deste componente.
// Reexportados aqui porque `components/kanban/index.ts` e a API pública do
// módulo já os expõem por este caminho.
export { countActiveFilters, type FilterSectionConfig };


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

// Ordered tier labels for chips (canonical labels come from the leads module).
function tierChipLabel(value: string[]): string {
  const labels = value
    .map((t) => QUALIFICATION_TIER_CONFIG[t as QualificationTier]?.label ?? t)
    .slice(0, 2)
    .join(", ");
  const suffix = value.length > 2 ? ` +${value.length - 2}` : "";
  return `${labels}${suffix}`;
}

export interface KanbanFilterPanelProps {
  sections: FilterSectionConfig[];
  onClearAll: () => void;
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
      case "qualification-tier": {
        if (section.value.length > 0) {
          chips.push({
            id: "qualification-tier",
            label: `Qualificação: ${tierChipLabel(section.value)}`,
            onRemove: () => section.onChange([]),
          });
        }
        break;
      }
      case "pre-qualification-tier": {
        if (section.value.length > 0) {
          chips.push({
            id: "pre-qualification-tier",
            label: `Pré-qualificação: ${tierChipLabel(section.value)}`,
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
      case "created-period": {
        const range = getDateRange(section.value);
        if (range) {
          chips.push({
            id: "created-period",
            label: `Criados: ${formatRangeLabel(range)}`,
            onRemove: () => section.onChange(createInitialPeriodState()),
          });
        }
        break;
      }
      case "stalled-days": {
        if (section.value && section.value !== STALLED_ALL) {
          chips.push({
            id: "stalled-days",
            label: `Parado há: ${stalledBucketLabel(section.value)}`,
            onRemove: () => section.onChange(STALLED_ALL),
          });
        }
        break;
      }
      case "single-choice": {
        const allValue = section.allValue ?? "all";
        if (section.value !== allValue) {
          const opt = section.options.find((o) => o.value === section.value);
          chips.push({
            id: section.id,
            label: `${section.label}: ${opt?.label ?? section.value}`,
            onRemove: () => section.onChange(allValue),
          });
        }
        break;
      }
    }
  }

  return chips;
}

/**
 * Rótulo curto do intervalo. Lê os componentes da string ISO em vez de
 * `new Date(...)` porque `getDateRange` devolve as pontas já normalizadas em
 * UTC — reidratar pro fuso local jogaria a data um dia pra trás no Brasil.
 */
function formatRangeLabel(range: { startStr: string; endStr: string }): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return format(new Date(y, m - 1, d), "dd MMM", { locale: ptBR });
  };
  const start = fmt(range.startStr);
  const end = fmt(range.endStr);
  return start === end ? start : `${start} – ${end}`;
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

    case "qualification-tier":
      return (
        <FilterSectionWrapper icon={Gem} label="Qualificação">
          <TierCheckboxList value={section.value} onChange={section.onChange} />
        </FilterSectionWrapper>
      );

    case "pre-qualification-tier":
      return (
        <FilterSectionWrapper icon={Sparkles} label="Pré-qualificação (IA)">
          <TierCheckboxList value={section.value} onChange={section.onChange} />
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

    case "single-choice": {
      const allValue = section.allValue ?? "all";
      return (
        <FilterSectionWrapper icon={section.icon ?? Clock} label={section.label}>
          <div className="flex flex-wrap gap-1.5">
            {section.options.map((opt) => {
              const active = section.value === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => section.onChange(active ? allValue : opt.value)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </FilterSectionWrapper>
      );
    }

    case "created-period":
      return (
        <FilterSectionWrapper icon={CalendarRange} label="Criados no período">
          <CreatedPeriodSection value={section.value} onChange={section.onChange} />
        </FilterSectionWrapper>
      );

    case "stalled-days":
      return (
        <FilterSectionWrapper icon={Hourglass} label="Parado há">
          <div className="grid grid-cols-1 gap-1.5">
            {[{ id: STALLED_ALL, label: "Qualquer tempo" }, ...STALLED_BUCKETS].map(
              (bucket) => {
                const checked = (section.value || STALLED_ALL) === bucket.id;
                return (
                  <button
                    key={bucket.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => section.onChange(bucket.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                      "hover:bg-muted/50",
                      checked && "bg-primary/5 text-primary",
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        checked ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                    />
                    {bucket.label}
                  </button>
                );
              },
            )}
          </div>
        </FilterSectionWrapper>
      );
  }
}

// ─── Sub-component: created-period (atalhos + intervalo livre) ───────────────
const PERIOD_SHORTCUTS: { id: PeriodShortcut; label: string }[] = [
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "90d", label: "90 dias" },
  { id: "month", label: "Este mês" },
];

function CreatedPeriodSection({
  value,
  onChange,
}: {
  value: MetricsPeriodState;
  onChange: (v: MetricsPeriodState) => void;
}) {
  const activeShortcut = matchPeriodShortcut(value);
  const range = getDateRange(value);
  // O Calendar chama métodos de Date direto — o estado pode ter vindo do
  // localStorage ou de uma view salva, onde as datas viraram string.
  const custom = revivePeriodState(value).customRange;
  // Nada de data futura: o filtro é sobre leads que já entraram.
  const today = new Date();

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        {PERIOD_SHORTCUTS.map((shortcut) => {
          const active = activeShortcut === shortcut.id;
          return (
            <button
              key={shortcut.id}
              type="button"
              aria-pressed={active}
              onClick={() =>
                // Clicar no atalho que já vale desliga — sem isso o único jeito
                // de voltar pra "todos" seria o chip, que vive noutra tela.
                onChange(
                  active
                    ? createInitialPeriodState()
                    : applyPeriodShortcut(shortcut.id, value),
                )
              }
              className={cn(
                "rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {shortcut.label}
            </button>
          );
        })}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "w-full justify-start gap-2 text-xs font-normal",
              range && !activeShortcut && "border-primary/50 text-primary",
            )}
          >
            <CalendarRange className="size-3.5 shrink-0" />
            {range && !activeShortcut
              ? formatRangeLabel(range)
              : custom?.from && !custom.to
                ? "Selecione a data final…"
                : "Escolher datas"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 z-[60]" align="start">
          <Calendar
            mode="range"
            selected={custom?.from ? { from: custom.from, to: custom.to } : undefined}
            onSelect={(r: RDPDateRange | undefined) =>
              onChange({
                ...value,
                period: "custom",
                customRange: r?.from ? { from: r.from, to: r.to } : null,
              })
            }
            disabled={{ after: today }}
            numberOfMonths={1}
            locale={ptBR}
            defaultMonth={custom?.from ?? today}
          />
        </PopoverContent>
      </Popover>

      {range && (
        <button
          type="button"
          onClick={() => onChange(createInitialPeriodState())}
          className="text-[11px] text-muted-foreground transition-colors hover:text-destructive"
        >
          Limpar período
        </button>
      )}
    </div>
  );
}

// ─── Sub-component: qualification-tier multi-select (shared by both tier rows) ─
function TierCheckboxList({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {QUALIFICATION_TIERS.map((tier) => {
        const meta = QUALIFICATION_TIER_CONFIG[tier];
        const Icon = meta.icon;
        const checked = value.includes(tier);
        return (
          <label
            key={tier}
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
                  ? [...value, tier]
                  : value.filter((t) => t !== tier);
                onChange(next);
              }}
              className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
            <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.colorClass)} />
            <span className="text-sm">{meta.label}</span>
          </label>
        );
      })}
    </div>
  );
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
