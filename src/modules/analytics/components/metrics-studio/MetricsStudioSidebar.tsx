import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_CORTE,
  cortesVisiveis,
  type EngineMetric,
} from "@/modules/analytics/lib/metrics-studio-engine-map";
import type { MetricCustomDefinition } from "@/modules/analytics/hooks/useMetricCustomDefinitions";
import { PREFIXO_CUSTOM, ehMetricaPersonalizada } from "@/modules/analytics/hooks/useStudioCatalog";

interface MetricsStudioSidebarProps {
  metrics: EngineMetric[];
  personalizadas: MetricCustomDefinition[];
  openMetricIds: Set<string>;
  podeVerPorPessoa: boolean;
  /** Só admin compõe: definição de métrica muda o número que a org inteira lê. */
  podeCompor: boolean;
  onAdd: (metric: EngineMetric) => void;
  onCriar: () => void;
  onEditar: (def: MetricCustomDefinition) => void;
  onRemover: (def: MetricCustomDefinition) => void;
}

/** Normaliza acento para que "reuniao" ache "Reuniões". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * G1 do grill: a lista mostra SÓ o que tem número real. Desde a fatia 10 ela
 * tem duas seções — o que o motor calcula de fábrica e o que ESTA organização
 * compôs (Emenda 1 do ADR-0023).
 *
 * As duas seções ficam separadas de propósito: a de fábrica é vocabulário
 * fechado, revisado em migration; a personalizada é do cliente e ele a apaga
 * quando quiser. Misturá-las na mesma lista sugeriria que as duas têm a mesma
 * durabilidade.
 */
export function MetricsStudioSidebar({
  metrics, personalizadas, openMetricIds, podeVerPorPessoa, podeCompor,
  onAdd, onCriar, onEditar, onRemover,
}: MetricsStudioSidebarProps) {
  const [query, setQuery] = useState("");

  const { fabrica, custom } = useMemo(() => {
    const q = fold(query.trim());
    const filtradas = q ? metrics.filter((m) => fold(m.label).includes(q)) : metrics;
    return {
      fabrica: filtradas.filter((m) => !ehMetricaPersonalizada(m.id)),
      custom: filtradas.filter((m) => ehMetricaPersonalizada(m.id)),
    };
  }, [metrics, query]);

  const porId = useMemo(
    () => new Map(personalizadas.map((d) => [`${PREFIXO_CUSTOM}${d.id}`, d])),
    [personalizadas],
  );

  const total = fabrica.length + custom.length;

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-border/70 bg-background/60">
      <div className="space-y-2.5 border-b border-border/70 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-bold tracking-[-0.02em]">Métricas disponíveis</h2>
            <p className="text-[11px] text-muted-foreground/70">Clique para soltar no painel.</p>
          </div>
          {podeCompor && (
            <button
              type="button"
              onClick={onCriar}
              title="Criar métrica combinando as que já existem"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Sparkles className="h-3 w-3" />
              Criar
            </button>
          )}
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
        {total === 0 && (
          <p className="px-2 py-6 text-center text-[11px] text-muted-foreground/60">
            Nenhuma métrica para “{query}”.
          </p>
        )}

        {custom.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground/50">
              Suas métricas
            </p>
            <ul className="mb-2 space-y-px">
              {custom.map((metric) => {
                const def = porId.get(metric.id);
                return (
                  <li key={metric.id} className="group/item flex items-center">
                    <button
                      type="button"
                      onClick={() => onAdd(metric)}
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium">{metric.label}</span>
                        <span className="block truncate text-[10px] text-muted-foreground/60">
                          número do período
                        </span>
                      </span>
                      {openMetricIds.has(metric.id) && (
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                    </button>
                    {podeCompor && def && (
                      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/item:opacity-100">
                        <button
                          type="button"
                          onClick={() => onEditar(def)}
                          aria-label={`Editar ${def.name}`}
                          className="rounded-md p-1.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemover(def)}
                          aria-label={`Excluir ${def.name}`}
                          className="rounded-md p-1.5 text-muted-foreground/60 hover:bg-muted hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {custom.length > 0 && fabrica.length > 0 && (
          <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground/50">
            Do sistema
          </p>
        )}

        <ul className="space-y-px">
          {fabrica.map((metric) => {
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
        {total} de {metrics.length} métricas
      </div>
    </aside>
  );
}
