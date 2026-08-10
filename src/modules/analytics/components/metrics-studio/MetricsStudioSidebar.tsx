import { useMemo, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  METRIC_FAMILIES,
  READINESS_META,
  STUDIO_METRICS,
  type MetricReadiness,
  type StudioMetric,
} from "@/modules/analytics/lib/metrics-studio-catalog";

interface MetricsStudioSidebarProps {
  openMetricIds: Set<string>;
  onAdd: (metric: StudioMetric) => void;
}

const READINESS_ORDER: MetricReadiness[] = ["pronta", "parcial", "ausente"];

/** Normaliza acento para que "reuniao" ache "Reuniões". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MetricsStudioSidebar({ openMetricIds, onAdd }: MetricsStudioSidebarProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MetricReadiness | null>(null);

  const counts = useMemo(() => {
    const acc: Record<MetricReadiness, number> = { pronta: 0, parcial: 0, ausente: 0 };
    STUDIO_METRICS.forEach((m) => { acc[m.readiness] += 1; });
    return acc;
  }, []);

  const groups = useMemo(() => {
    const q = fold(query.trim());
    const matches = STUDIO_METRICS.filter((m) => {
      if (filter && m.readiness !== filter) return false;
      if (!q) return true;
      return fold(`${m.label} ${m.description} ${m.source}`).includes(q);
    });

    return METRIC_FAMILIES.map((family) => ({
      family,
      metrics: matches.filter((m) => m.family === family.id),
    })).filter((g) => g.metrics.length > 0);
  }, [query, filter]);

  const visible = groups.reduce((acc, g) => acc + g.metrics.length, 0);

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-border/70 bg-background/60">
      <div className="space-y-2.5 border-b border-border/70 px-4 py-3">
        <div>
          <h2 className="text-[13px] font-bold tracking-[-0.02em]">Métricas disponíveis</h2>
          <p className="text-[11px] text-muted-foreground/70">
            Clique para soltar no painel.
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar métrica…"
            aria-label="Buscar métrica"
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-2 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50"
          />
        </div>

        <div className="flex gap-1">
          {READINESS_ORDER.map((key) => {
            const meta = READINESS_META[key];
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(active ? null : key)}
                title={meta.hint}
                aria-pressed={active}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-1.5 py-1 text-[10px] font-semibold transition-colors",
                  active
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border/70 text-muted-foreground hover:text-foreground",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                {counts[key]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-[11px] text-muted-foreground/60">
            Nenhuma métrica para “{query}”.
          </p>
        )}

        {groups.map(({ family, metrics }) => (
          <section key={family.id} className="mb-3">
            <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">
              {family.label}
            </h3>
            <ul className="space-y-px">
              {metrics.map((metric) => {
                const isOpen = openMetricIds.has(metric.id);
                const meta = READINESS_META[metric.readiness];
                return (
                  <li key={metric.id}>
                    <button
                      type="button"
                      onClick={() => onAdd(metric)}
                      title={`${metric.description}\n${meta.label} · ${metric.source}`}
                      className="group flex w-full items-center gap-2 rounded-lg px-2 py-[7px] text-left transition-colors hover:bg-muted/60"
                    >
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                        {metric.label}
                      </span>
                      {metric.composable && (
                        <span
                          title="Já é medida do catálogo montável (ADR-0023)"
                          className="shrink-0 rounded border border-primary/25 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-primary/80"
                        >
                          motor
                        </span>
                      )}
                      {isOpen ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      ) : (
                        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="border-t border-border/70 px-4 py-2 text-[10px] text-muted-foreground/60">
        {visible} de {STUDIO_METRICS.length} métricas
      </div>
    </aside>
  );
}
