import { useState } from "react";
import { Check, Clock, DollarSign, FileText, Grip, LayoutGrid, Receipt, RotateCcw, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DraggableWidgetGrid, type WidgetItem } from "@/components/ui/draggable-widget-grid";

const DEFINITIONS = [
  { id: "revenue", size: "wide", label: "Receita do Mês", icon: DollarSign, format: "currency", detail: "Vendas no período selecionado" },
  { id: "leads", size: "sm", label: "Leads Captados", icon: Users, format: "number", detail: "Novas oportunidades" },
  { id: "ticket", size: "sm", label: "Ticket Médio", icon: Receipt, format: "currency", detail: "Valor médio por venda" },
  { id: "proposals", size: "sm", label: "Propostas Enviadas", icon: FileText, format: "number", detail: "Propostas no período" },
  { id: "conversion", size: "wide", label: "Taxa de Conversão", icon: TrendingUp, format: "percent", detail: "Conversão no período" },
  { id: "response", size: "sm", label: "Tempo de Resposta", icon: Clock, format: "minutes", detail: "Tempo médio de atendimento" },
] as const;

type MetricId = typeof DEFINITIONS[number]["id"];
export interface MetricsWidgetGridProps {
  values: Record<MetricId, number>;
  /** Scope by organization and user. Only layout IDs are stored. */
  storageKey?: string;
}

const defaults = (): WidgetItem[] => DEFINITIONS.map(({ id, size, label }) => ({ id, size, label }));

function readLayout(key?: string): WidgetItem[] {
  if (!key) return defaults();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!Array.isArray(saved) || saved.length !== DEFINITIONS.length || new Set(saved).size !== saved.length) return defaults();
    const items = defaults();
    if (!saved.every(id => typeof id === "string" && items.some(item => item.id === id))) return items;
    return saved.map(id => items.find(item => item.id === id)!);
  } catch {
    return defaults();
  }
}

function formatValue(value: number, format: string) {
  if (format === "currency") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
  if (format === "percent") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (format === "minutes") return value >= 60 ? `${(value / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : `${Math.round(value)} min`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/** Remount layout state when the authenticated scope changes. */
export function MetricsWidgetGrid(props: MetricsWidgetGridProps) {
  return <ScopedMetricsWidgetGrid key={props.storageKey ?? "session"} {...props} />;
}

function ScopedMetricsWidgetGrid({ values, storageKey }: MetricsWidgetGridProps) {
  const [items, setItems] = useState(() => readLayout(storageKey));
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("");

  const save = (next: WidgetItem[]) => {
    setItems(next);
    if (!storageKey) {
      setStatus("Layout atualizado nesta sessão.");
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(next.map(item => item.id)));
      setStatus("Layout salvo neste navegador.");
    } catch {
      setStatus("Layout atualizado. Não foi possível salvar neste navegador.");
    }
  };

  return (
    <section aria-label="Indicadores do período" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Seus indicadores</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {editing ? "Arraste os widgets. No celular, toque e segure. No teclado, Alt + setas." : "O desempenho do período, na sua ordem."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editing && (
            <Button variant="ghost" size="sm" onClick={() => { save(defaults()); setRevision(value => value + 1); }}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Restaurar
            </Button>
          )}
          <Button variant={editing ? "default" : "outline"} size="sm" aria-pressed={editing} onClick={() => setEditing(value => !value)}>
            {editing ? <Check className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> : <LayoutGrid className="mr-2 h-3.5 w-3.5" aria-hidden="true" />}
            {editing ? "Concluir" : "Organizar widgets"}
          </Button>
        </div>
      </div>
      <DraggableWidgetGrid
        key={revision}
        items={items}
        onChange={save}
        editable={editing}
        maxColumns={4}
        cellSize={220}
        rowHeight={164}
        gap={16}
        radius={20}
        renderItem={item => {
          const definition = DEFINITIONS.find(metric => metric.id === item.id)!;
          const Icon = definition.icon;
          const prominent = item.id === "revenue";
          return (
            <div className={`relative flex h-full flex-col justify-between p-5 ${prominent ? "bg-primary/[0.06]" : ""}`}>
              {prominent && <span aria-hidden="true" className="absolute bottom-5 left-0 top-5 w-0.5 rounded-full bg-primary" />}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">{definition.label}</span>
                {editing ? <Grip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Icon className={`h-4 w-4 shrink-0 ${prominent ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />}
              </div>
              <div>
                <p className="break-words text-[clamp(1.5rem,2.3vw,2rem)] font-semibold leading-tight tracking-[-0.04em] tabular-nums">{formatValue(values[definition.id], definition.format)}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">{definition.detail}</p>
              </div>
            </div>
          );
        }}
      />
      <p role="status" className="sr-only">{status}</p>
    </section>
  );
}
