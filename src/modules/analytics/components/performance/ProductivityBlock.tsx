import { useMemo, useState } from "react";
import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  subDays,
  subMonths,
  format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  UserPlus,
  CalendarPlus,
  CalendarCheck,
  Trophy,
  Info,
  Calendar as CalendarIcon,
} from "lucide-react";
import type { DateRange as RDPDateRange } from "react-day-picker";
import { KpiRow } from "@/components/ui/bento";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isVirtualTeamMember, type TeamMember } from "@/modules/identity";
import {
  useProductivityActivity,
  type ProductivityCountType,
} from "@/modules/analytics/hooks/useProductivityActivity";
import { ProductivityDrill } from "./ProductivityDrill";
import { ProductivitySellerBoard } from "./ProductivitySellerBoard";

type Preset = "today" | "7d" | "month" | "last_month" | "custom";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "custom", label: "Personalizado" },
];

interface CardDef {
  key: ProductivityCountType;
  label: string;
  icon: typeof UserPlus;
}

const CARDS: CardDef[] = [
  { key: "novos_leads", label: "Novos leads", icon: UserPlus },
  { key: "reunioes_marcadas", label: "Reuniões Marcadas", icon: CalendarPlus },
  { key: "reunioes_realizadas", label: "Reuniões Realizadas", icon: CalendarCheck },
  { key: "vendido", label: "Vendido", icon: Trophy },
];

/** Resolve [from,to] ISO strings for a preset (or custom range). */
function resolveRange(preset: Preset, custom: RDPDateRange | undefined) {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "7d":
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "last_month": {
      const prev = subMonths(now, 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case "custom":
      if (custom?.from) {
        return {
          from: startOfDay(custom.from),
          to: endOfDay(custom.to ?? custom.from),
        };
      }
      return { from: startOfMonth(now), to: endOfMonth(now) };
  }
}

interface ProductivityBlockProps {
  teamMembers: TeamMember[];
}

export function ProductivityBlock({ teamMembers }: ProductivityBlockProps) {
  const [preset, setPreset] = useState<Preset>("month");
  const [customRange, setCustomRange] = useState<RDPDateRange | undefined>();
  const [seller, setSeller] = useState<string>("all");
  const [drillType, setDrillType] = useState<ProductivityCountType | null>(null);

  const { from, to } = useMemo(() => {
    const r = resolveRange(preset, customRange);
    return { from: r.from.toISOString(), to: r.to.toISOString() };
  }, [preset, customRange]);

  const sellerId = seller === "all" ? null : seller;
  const { data, isLoading } = useProductivityActivity(from, to, sellerId);

  const sellableMembers = useMemo(
    () =>
      teamMembers.filter((m) => m.is_active && !isVirtualTeamMember(m.id)),
    [teamMembers],
  );

  const rangeLabel = `${format(new Date(from), "dd MMM", { locale: ptBR })} — ${format(
    new Date(to),
    "dd MMM yyyy",
    { locale: ptBR },
  )}`;

  return (
    <section className="space-y-4">
      {/* Header: title + explicit action-date note */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-bold tracking-[-0.02em]">Produtividade</h2>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Como a Produtividade conta"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Cada número é contado pela <strong>data da ação</strong>{" "}
                  (reunião marcada, realizada, venda, entrada do lead), não pela
                  data em que o lead entrou. Um lead de maio que marcou reunião
                  em junho conta em junho.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            Conta pela <span className="font-medium text-foreground/80">data-da-ação</span>,
            não pela entrada do lead.
          </p>
        </div>

        {/* Period + seller selectors — independent from the page month/year */}
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={preset} onValueChange={(v) => setPreset(v as Preset)}>
            <TabsList variant="segmented" aria-label="Período da produtividade">
              {PRESETS.map((p) => (
                <TabsTrigger key={p.value} value={p.value}>
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {preset === "custom" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2 text-xs font-medium tabular-nums"
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {customRange?.from
                    ? customRange.to
                      ? `${format(customRange.from, "dd MMM", { locale: ptBR })} — ${format(customRange.to, "dd MMM", { locale: ptBR })}`
                      : `${format(customRange.from, "dd MMM", { locale: ptBR })} — ...`
                    : "Selecionar intervalo"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={customRange}
                  onSelect={setCustomRange}
                  numberOfMonths={2}
                  locale={ptBR}
                  defaultMonth={customRange?.from ?? new Date()}
                />
              </PopoverContent>
            </Popover>
          )}

          <Select value={seller} onValueChange={setSeller}>
            <SelectTrigger className="h-9 w-[180px] text-xs" aria-label="Vendedor">
              <SelectValue placeholder="Vendedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os vendedores</SelectItem>
              {sellableMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 4 counts */}
      <KpiRow cols={4}>
        {CARDS.map((card) => {
          const Icon = card.icon;
          const value = data ? data[card.key] : 0;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setDrillType(card.key)}
              className={cn(
                // Mesma anatomia do `KpiTile` do bento, mas como BOTÃO — o
                // cartão abre o detalhamento, e KpiTile é uma div.
                "group relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-card border border-card-border bg-card p-[18px] text-left text-card-foreground shadow-relevo",
                "transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-relevo-alto motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground/80">
                  {card.label}
                </span>
                <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] bg-muted text-foreground/70 transition-colors group-hover:bg-primary-soft group-hover:text-primary-soft-foreground">
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-[1.65rem] font-extrabold leading-[1.05] tracking-[-0.04em] tabular-nums">
                  {value.toLocaleString("pt-BR")}
                </p>
              )}
              <p className="text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                Ver leads
              </p>
            </button>
          );
        })}
      </KpiRow>

      <p className="text-[12px] text-muted-foreground tabular-nums">
        Período: {rangeLabel}
        {sellerId
          ? ` · ${sellableMembers.find((m) => m.id === sellerId)?.name ?? "vendedor"}`
          : " · todos os vendedores"}
      </p>

      {/* Placar por vendedor — mesmo período dos cards acima */}
      <ProductivitySellerBoard from={from} to={to} />

      <ProductivityDrill
        countType={drillType}
        from={from}
        to={to}
        seller={sellerId}
        open={drillType !== null}
        onOpenChange={(open) => {
          if (!open) setDrillType(null);
        }}
      />
    </section>
  );
}
