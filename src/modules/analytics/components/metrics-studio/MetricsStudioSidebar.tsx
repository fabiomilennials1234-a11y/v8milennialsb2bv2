import { useMemo, useState } from "react";
import { Check, ChevronDown, LayoutTemplate, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_CORTE,
  cortesVisiveis,
  type EngineMetric,
} from "@/modules/analytics/lib/metrics-studio-engine-map";
import type { MetricCustomDefinition } from "@/modules/analytics/hooks/useMetricCustomDefinitions";
import { PREFIXO_CUSTOM, ehMetricaPersonalizada } from "@/modules/analytics/hooks/useStudioCatalog";
import { FIXED_CARDS } from "@/modules/analytics/lib/metrics-studio-fixed-cards";
import { Button } from "@/components/ui/button";

interface MetricsStudioSidebarProps {
  metrics: EngineMetric[];
  personalizadas: MetricCustomDefinition[];
  openMetricIds: Set<string>;
  podeVerPorPessoa: boolean;
  /** Só admin compõe: definição de métrica muda o número que a org inteira lê. */
  podeCompor: boolean;
  onAdd: (metric: EngineMetric) => void;
  onAddFixed: (id: string, size: { w: number; h: number }) => void;
  onCriar: () => void;
  onEditar: (def: MetricCustomDefinition) => void;
  onRemover: (def: MetricCustomDefinition) => void;
}

const ITEM = "flex min-w-0 flex-1 items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ROTULO_SECAO = "px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground";

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
  onAdd, onAddFixed, onCriar, onEditar, onRemover,
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
    <aside className="flex h-56 w-full shrink-0 flex-col border-b border-border/60 bg-card sm:h-full sm:w-[300px] sm:border-b-0 sm:border-r">
      <div className="space-y-3 px-4 pb-3 pt-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold tracking-[-0.02em]">Métricas disponíveis</h2>
            <p className="text-xs text-muted-foreground">Clique para soltar no painel.</p>
          </div>
          {podeCompor && (
            <Button
              type="button"
              size="sm"
              variant="ink"
              onClick={onCriar}
              title="Criar métrica combinando as que já existem"
              className="h-8 shrink-0 px-3"
            >
              <Sparkles />
              Criar
            </Button>
          )}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar métrica…"
            aria-label="Buscar métrica"
            className="h-9 w-full rounded-full border border-transparent bg-muted pl-8 pr-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-input focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {total === 0 && (
          <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
            Nenhuma métrica para “{query}”.
          </p>
        )}

        {custom.length > 0 && (
          <>
            <p className={ROTULO_SECAO}>Suas métricas</p>
            <ul className="mb-2 space-y-px">
              {custom.map((metric) => {
                const def = porId.get(metric.id);
                return (
                  <li key={metric.id} className="group/item flex items-center">
                    <button
                      type="button"
                      onClick={() => onAdd(metric)}
                      className={ITEM}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{metric.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          número do período
                        </span>
                      </span>
                      {openMetricIds.has(metric.id) && (
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-soft-foreground" />
                      )}
                    </button>
                    {podeCompor && def && (
                      <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/item:opacity-100">
                        <button
                          type="button"
                          onClick={() => onEditar(def)}
                          aria-label={`Editar ${def.name}`}
                          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemover(def)}
                          aria-label={`Excluir ${def.name}`}
                          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
          <p className={ROTULO_SECAO}>Do sistema</p>
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
                  className={cn(ITEM, "group w-full")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{metric.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {cortes.length > 1 ? `${cortes.length} cortes` : "número do período"}
                    </span>
                  </span>
                  {isOpen ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-soft-foreground" />
                  ) : (
                    <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-transparent transition-colors group-hover:text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-border/60 px-4 py-2 text-[11px] tabular-nums text-muted-foreground">
        {total} de {metrics.length} métricas
      </div>
      <details className="group/cards max-h-[45%] overflow-auto border-t border-border/60 px-2 pb-2" open={query.length > 0}>
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2.5 text-[13px] font-semibold hover:bg-muted [&::-webkit-details-marker]:hidden">
          <LayoutTemplate className="h-4 w-4 text-muted-foreground" aria-hidden />
          Cards dos dashboards
          <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-open/cards:rotate-180" aria-hidden />
        </summary>
        <ul className="flex flex-col gap-px">
          {Object.entries(FIXED_CARDS).filter(([, card]) => (!card.requiresPerformance || podeVerPorPessoa) && fold(card.label).includes(fold(query))).map(([id, card]) => (
            <li key={id}>
              <button type="button" className={cn(ITEM, "group w-full items-center")} onClick={() => onAddFixed(id, card.tamanhoPadrao)}>
                <span className="min-w-0 flex-1 text-[13px] font-semibold">{card.label}</span>
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
