import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTeamMembers } from "@/modules/identity";
import { type DatePreset, useAnalyticsFilters } from "@/modules/analytics/hooks/useAnalyticsFilters";

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "14d", label: "14 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
];

const ORIGINS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meta_ads", label: "Meta Ads" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "Tiktok" },
  { value: "google_ads", label: "Google Ads" },
  { value: "site", label: "Site" },
  { value: "landing_page", label: "Landing Page" },
  { value: "remarketing", label: "Remarketing" },
  { value: "indicacao", label: "Indicação" },
  { value: "evento", label: "Evento" },
  { value: "prospeccao_ativa", label: "Prospecção Ativa" },
  { value: "cal", label: "Calendário" },
  { value: "outro", label: "Outro" },
];

export function AnalyticsFilters() {
  const {
    filters,
    setPreset,
    toggleCompare,
    setMemberId,
    setOrigin,
  } = useAnalyticsFilters();

  const { data: teamMembers } = useTeamMembers();

  const dateLabel = `${format(new Date(filters.startDate), "dd MMM", { locale: ptBR })} — ${format(new Date(filters.endDate), "dd MMM yyyy", { locale: ptBR })}`;

  return (
    <div className="sticky top-0 z-10 -mx-1 border-b border-border/40 bg-card/85 px-1 py-3 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Time group — left */}
        <div className="flex items-center gap-2">
          {/* Alternador claro do V5 (segmented); mesmos botões, mesmo clique. */}
          <div className="flex items-center gap-0.5 rounded-full bg-muted p-[3px]">
            {PRESETS.map((p) => (
              <Button
                key={p.value}
                variant="ghost"
                size="sm"
                aria-pressed={filters.preset === p.value}
                className={cn(
                  "h-7 rounded-full px-3 text-xs hover:bg-transparent",
                  filters.preset === p.value
                    ? "bg-card text-foreground shadow-relevo hover:bg-card"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setPreset(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs tabular-nums text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            {dateLabel}
          </div>
        </div>

        {/* Dimension group — right */}
        <div className="flex items-center gap-2">
          <Select
            value={filters.memberId ?? "all"}
            onValueChange={(v) => setMemberId(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-[180px] h-8 text-xs bg-transparent border-border/50 hover:border-primary/30 transition-colors">
              <SelectValue placeholder="Todos os vendedores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os vendedores</SelectItem>
              {teamMembers
                ?.filter((m) => m.is_active)
                .map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.origin ?? "all"}
            onValueChange={(v) => setOrigin(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs bg-transparent border-border/50 hover:border-primary/30 transition-colors">
              <SelectValue placeholder="Todas as origens" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as origens</SelectItem>
              {ORIGINS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={filters.compareEnabled ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs border-border/50"
            onClick={toggleCompare}
          >
            <GitCompare className="h-3.5 w-3.5 mr-1" />
            vs anterior
          </Button>
        </div>
      </div>
    </div>
  );
}
