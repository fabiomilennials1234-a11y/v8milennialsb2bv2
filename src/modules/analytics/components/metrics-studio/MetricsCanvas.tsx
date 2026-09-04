import { forwardRef } from "react";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartKind } from "@/modules/analytics/lib/metrics-studio-catalog";
import type { EngineMetric, MetricRecorte } from "@/modules/analytics/lib/metrics-studio-engine-map";
import type { StudioPeriod, StudioRange } from "@/modules/analytics/lib/metrics-studio-period";
import type { StudioWindow } from "@/modules/analytics/hooks/useMetricsStudio";
import { MetricWindow } from "./MetricWindow";
import { FixedWindow } from "./FixedWindow";
import { isFixedWindow } from "@/modules/analytics/lib/metrics-studio-window";

interface MetricsCanvasProps {
  windows: StudioWindow[];
  /**
   * Resolvedor de `metricId` → métrica. Vem do catálogo do Estúdio, que junta
   * as de fábrica com as personalizadas da organização — por isso não é mais um
   * `Map` estático de import.
   */
  byId: Map<string, EngineMetric>;
  /**
   * Intervalo CONCRETO do painel, para os cards sob medida.
   *
   * As janelas de métrica mandam `period`/`range` crus e deixam o motor cortar
   * no fuso da org. Os cards sob medida buscam os próprios dados no cliente e
   * precisam de datas resolvidas — e resolvê-las aqui, na mão, faria a semana
   * começar no domingo (JS) contra a segunda do motor (`date_trunc('week')`),
   * e usaria o fuso do browser contra o `organizations.timezone` do servidor.
   * Dois cards lado a lado mostrariam períodos diferentes, sem erro nenhum.
   *
   * Por isso vem PRONTO de cima, do mesmo `computePeriodRange` que o Comando já
   * usa para alimentar exatamente estes componentes.
   */
  intervalo: { start: Date; end: Date };
  period: StudioPeriod;
  range?: StudioRange | null;
  podeVerPorPessoa: boolean;
  editavel: boolean;
  /**
   * Se este usuário PODE entrar em edição — admin de equipe ou master.
   * Diferente de `editavel`, que é "está editando AGORA". Sem esta distinção o
   * painel vazio oferece "Montar painel" a quem a RLS vai recusar.
   */
  podeEditar: boolean;
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
  { windows, byId, intervalo, period, range, podeVerPorPessoa, editavel, podeEditar, onEditar, selectedId, size, onSelect, onMove, onResize, onChart, onCorte, onRemove },
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
                : podeEditar
                  ? "Monte o painel da organização com as métricas que o time acompanha."
                  : "O painel é o mesmo para toda a organização e ainda não foi montado. Quem configura é um administrador."}
            </p>
          </div>
          {/* Em Visualização o painel vazio seria um beco sem saída: sem a
              lista lateral, não há como adicionar nada. O convite é a saída —
              mas só para quem tem para onde ir. Oferecer "Montar painel" a
              membro seria mandá-lo bater numa recusa da RLS. */}
          {!editavel && podeEditar && (
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
        // Janela cuja métrica sumiu do catálogo (personalizada apagada por um
        // admin, por exemplo) simplesmente não desenha. Não é erro: é uma
        // definição que deixou de existir, e o painel do usuário não some por
        // causa disso.
        // Card sob medida resolve pelo registry e IGNORA `metricId` — precisa
        // vir antes da busca no catálogo, que não o encontraria.
        if (isFixedWindow(win)) {
          return (
            <FixedWindow
              key={win.id}
              win={win}
              range={intervalo}
              editavel={editavel}
              selected={selectedId === win.id}
              canvas={size}
              onSelect={onSelect}
              onMove={onMove}
              onResize={onResize}
              onRemove={onRemove}
            />
          );
        }

        const metric = byId.get(win.metricId);
        if (!metric) return null;
        return (
          <MetricWindow
            key={win.id}
            win={win}
            metric={metric}
            period={period}
            range={range}
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
