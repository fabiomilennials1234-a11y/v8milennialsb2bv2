import { forwardRef } from "react";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartKind } from "@/modules/analytics/lib/metrics-studio-catalog";
import { ENGINE_BY_ID, type MetricRecorte } from "@/modules/analytics/lib/metrics-studio-engine-map";
import type { StudioPeriod } from "@/modules/analytics/lib/metrics-studio-period";
import type { StudioWindow } from "@/modules/analytics/hooks/useMetricsStudio";
import { MetricWindow } from "./MetricWindow";

interface MetricsCanvasProps {
  windows: StudioWindow[];
  period: StudioPeriod;
  podeVerPorPessoa: boolean;
  editavel: boolean;
  onEditar: () => void;
  selectedId: string | null;
  size: { width: number; height: number };
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onChart: (id: string, chart: ChartKind) => void;
  onCorte: (id: string, corte: MetricRecorte) => void;
  onRemove: (id: string) => void;
}

/**
 * Painel em branco. Grid pontilhado de 24px como referência visual — o encaixe
 * real do arrasto é de 8px (GRID), mais fino que a malha desenhada de propósito:
 * a malha orienta, não prende.
 */
export const MetricsCanvas = forwardRef<HTMLDivElement, MetricsCanvasProps>(function MetricsCanvas(
  { windows, period, podeVerPorPessoa, editavel, onEditar, selectedId, size, onSelect, onMove, onResize, onChart, onCorte, onRemove },
  ref,
) {
  const empty = windows.length === 0;

  // O painel é uma região da página, não o viewport: quando as janelas passam
  // da dobra, o canvas cresce e rola em vez de empilhar em cascata.
  const contentHeight = windows.reduce((acc, w) => Math.max(acc, w.y + w.h + 24), 0);

  return (
    <div className="h-full w-full overflow-auto">
      <div
        ref={ref}
        onPointerDown={(e) => {
          if (editavel && e.target === e.currentTarget) onSelect(null);
        }}
        style={{ backgroundPosition: "12px 12px", minHeight: Math.max(contentHeight, 0) || undefined }}
        className={cn(
          "relative h-full min-h-full w-full",
          "bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px]",
          "bg-background",
        )}
      >
      {empty && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-2xl border border-dashed border-border/70 p-4">
            <LayoutGrid className="h-6 w-6 text-muted-foreground/40" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-[13px] font-semibold">Painel em branco</p>
            <p className="mt-0.5 max-w-[320px] text-[11px] leading-relaxed text-muted-foreground/60">
              {editavel
                ? "Escolha uma métrica na lista ao lado. Ela vira uma janela aqui — arraste pela barra de título, redimensione pela borda e troque o corte ao selecioná-la."
                : "Monte o painel com as métricas que você acompanha."}
            </p>
          </div>
          {/* Em Visualização o painel vazio seria um beco sem saída: sem a
              lista lateral, não há como adicionar nada. O convite é a saída. */}
          {!editavel && (
            <button
              type="button"
              onClick={onEditar}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-primary px-4 py-[9px] text-[13px] font-bold text-primary-foreground transition-transform duration-150 hover:-translate-y-px"
            >
              Montar painel
            </button>
          )}
        </div>
      )}

      {windows.map((win) => {
        const metric = ENGINE_BY_ID.get(win.metricId);
        if (!metric) return null;
        return (
          <MetricWindow
            key={win.id}
            win={win}
            metric={metric}
            period={period}
            podeVerPorPessoa={podeVerPorPessoa}
            editavel={editavel}
            selected={selectedId === win.id}
            canvas={size}
            onSelect={onSelect}
            onMove={onMove}
            onResize={onResize}
            onChart={onChart}
            onCorte={onCorte}
            onRemove={onRemove}
          />
        );
      })}
      </div>
    </div>
  );
});
