import { useMemo, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ENGINE_METRICS,
  ROTULO_DO_CORTE,
  cortesVisiveis,
  type EngineMetric,
} from "@/modules/analytics/lib/metrics-studio-engine-map";

interface MetricsStudioSidebarProps {
  openMetricIds: Set<string>;
  podeVerPorPessoa: boolean;
  onAdd: (metric: EngineMetric) => void;
}

/** Normaliza acento para que "reuniao" ache "Reuniões". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * G1 do grill: a lista mostra SÓ o que tem número real — as 7 medidas e as 3
 * razões que o motor calcula em produção. As outras 19 do inventário
 * (`metrics-studio-catalog.ts`) não aparecem: amostra não vai para a frente do
 * cliente.
 */
export function MetricsStudioSidebar({ openMetricIds, podeVerPorPessoa, onAdd }: MetricsStudioSidebarProps) {
  const [query, setQuery] = useState("");

  const visiveis = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return ENGINE_METRICS;
    return ENGINE_METRICS.filter((m) => fold(m.label).includes(q));
  }, [query]);

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-border/70 bg-background/60">
      <div className="space-y-2.5 border-b border-border/70 px-4 py-3">
        <div>
          <h2 className="text-[13px] font-bold tracking-[-0.02em]">Métricas disponíveis</h2>
          <p className="text-[11px] text-muted-foreground/70">Clique para soltar no painel.</p>
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {visiveis.length === 0 && (
          <p className="px-2 py-6 text-center text-[11px] text-muted-foreground/60">
            Nenhuma métrica para “{query}”.
          </p>
        )}

        <ul className="space-y-px">
          {visiveis.map((metric) => {
            const isOpen = openMetricIds.has(metric.id);
            const cortes = cortesVisiveis(metric, podeVerPorPessoa);
            return (
              <li key={metric.id}>
                <button
                  type="button"
                  onClick={() => onAdd(metric)}
                  title={cortes.map((c) => ROTULO_DO_CORTE[c]).join(" · ")}
                  className="group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">{metric.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground/60">
                      {cortes.length > 1 ? `${cortes.length} cortes` : "número do período"}
                    </span>
                  </span>
                  {isOpen ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : (
                    <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={cn("border-t border-border/70 px-4 py-2 text-[10px] text-muted-foreground/60")}>
        {visiveis.length} de {ENGINE_METRICS.length} métricas
      </div>
    </aside>
  );
}
