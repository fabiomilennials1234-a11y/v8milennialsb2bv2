import { forwardRef } from "react";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ChartKind } from "@/modules/analytics/lib/metrics-studio-catalog";
import type { EngineMetric, MetricRecorte } from "@/modules/analytics/lib/metrics-studio-engine-map";
import type { StudioPeriod, StudioRange } from "@/modules/analytics/lib/metrics-studio-period";
import type { StudioWindow } from "@/modules/analytics/hooks/useMetricsStudio";
import { MetricWindow } from "./MetricWindow";
import { FixedWindow } from "./FixedWindow";
import { isFixedWindow } from "@/modules/analytics/lib/metrics-studio-window";
import type { FixedCardContext } from "@/modules/analytics/lib/metrics-studio-fixed-card-contract";
import { projectStudioWindows } from "@/modules/analytics/lib/metrics-studio-projection";

interface MetricsCanvasProps {
  fillWidth?: boolean;
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
   * Por isso vem PRONTO de cima, de `studioInterval`, alinhado ao calendário
   * da org e aos presets do motor (trimestre até hoje).
   */
  intervalo: FixedCardContext["range"];
  monthlyRange: FixedCardContext["range"];
  month: number;
  year: number;
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
  { windows, byId, intervalo, monthlyRange, month, year, period, range, podeVerPorPessoa, editavel, podeEditar, onEditar, selectedId, size, onSelect, onMove, onResize, onChart, onCorte, onRemove, fillWidth },
  ref,
) {
  const empty = windows.length === 0;
  const displayed = editavel ? windows : projectStudioWindows(windows, size.width, fillWidth);

  // O painel é uma região da página, não o viewport: quando as janelas passam
  // da dobra, o canvas cresce e rola em vez de empilhar em cascata.
  const contentHeight = displayed.reduce((acc, w) => Math.max(acc, w.y + w.h + 24), 0);

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
          // Edição: mesa de trabalho afundada com a malha de referência.
          // Visualização: sem fundo — os cards pousam na própria bancada.
          editavel && "bg-sunken bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px]",
        )}
      >
      {empty && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <LayoutGrid className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold">Painel em branco</p>
            <p className="mx-auto mt-1 max-w-[340px] text-[13px] leading-relaxed text-muted-foreground">
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
            <Button type="button" onClick={onEditar}>
              Montar painel
            </Button>
          )}
        </div>
      )}

      {displayed.map((win) => {
        // Card sob medida resolve pelo registry e IGNORA `metricId` — precisa
        // vir antes da busca no catálogo, que não o encontraria.
        if (isFixedWindow(win)) {
          return (
            <FixedWindow
              key={win.id}
              win={win}
              context={{ range: intervalo, monthlyRange, month, year, period }}
              podeVerPorPessoa={podeVerPorPessoa}
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
        if (!metric) return (
          <div key={win.id} role="group" aria-label="Métrica indisponível"
            className="absolute overflow-auto rounded-card border border-dashed border-border bg-card/60 p-1" style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}>
            <Alert className="rounded-[18px] border-0 bg-transparent"><AlertTitle className="font-semibold">Métrica indisponível</AlertTitle><AlertDescription className="text-[13px] text-muted-foreground">
              O card continua salvo. O catálogo pode estar carregando ou esta métrica não está mais disponível.
            </AlertDescription></Alert>
          </div>
        );
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
