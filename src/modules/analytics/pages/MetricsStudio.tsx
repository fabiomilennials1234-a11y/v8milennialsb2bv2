import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Gauge, PanelLeftClose, PanelLeftOpen, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MetricsCanvas } from "@/modules/analytics/components/metrics-studio/MetricsCanvas";
import { MetricsStudioSidebar } from "@/modules/analytics/components/metrics-studio/MetricsStudioSidebar";
import { useMetricsStudio } from "@/modules/analytics/hooks/useMetricsStudio";
import type { ChartKind, StudioMetric } from "@/modules/analytics/lib/metrics-studio-catalog";

const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
  { key: "quarter", label: "Trim." },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

/**
 * Estúdio de Métricas — `/metricas`.
 *
 * PÁGINA NORMAL do sistema, não canvas full-screen. A top bar do Torque, o
 * padding e o cabeçalho do `<main>` continuam valendo; a rota só entra em
 * WIDE_LAYOUT_PATTERNS (como os kanbans) para soltar o `max-w-[1600px]`.
 *
 * O painel é uma REGIÃO da página com altura própria, não o viewport inteiro:
 * a primeira versão era full-bleed e comia a top bar, o que fazia a tela
 * parecer outro produto. Aqui o estúdio é um painel emoldurado — mesma
 * gramática de card do resto do app.
 *
 * Estado de composição: `useMetricsStudio` (persistido por org+usuário).
 * Números: amostra determinística (`metrics-studio-sample`). Trocar pelo motor
 * `fn_metric_measure` não muda nenhum componente desta árvore.
 */
export default function MetricsStudio() {
  const studio = useMetricsStudio();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>("month");

  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Altura do painel MEDIDA, não chutada. A primeira versão usava
  // `h-[calc(100vh-15rem)]`: 240px fixos contra ~142px de cromo real, o que
  // deixava ~98px de área morta embaixo. E o padding do <main> é responsivo
  // (py-5 sm:py-6 lg:py-8), então qualquer constante erra em algum breakpoint.
  // Aqui o topo do painel é lido do layout e o rodapé respeita o padding real.
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const medir = () => {
      const el = panelRef.current;
      if (!el) return;
      const topo = el.getBoundingClientRect().top;
      // O padding do layout está num DIV interno do <main>, não no <main> —
      // por isso subimos até achar quem de fato tem padding-bottom, em vez de
      // ler direto do <main> (que devolve 0 e cola o painel na borda).
      let respiro = 0;
      for (let n = el.parentElement, i = 0; n && i < 6; n = n.parentElement, i++) {
        const p = parseFloat(getComputedStyle(n).paddingBottom) || 0;
        if (p > 0) { respiro = p; break; }
      }
      setPanelHeight(Math.max(420, window.innerHeight - topo - respiro));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleAdd = useCallback(
    (metric: StudioMetric) => studio.addMetric(metric, canvasSize),
    [studio, canvasSize],
  );

  const handleRemove = useCallback(
    (id: string) => {
      studio.removeWindow(id);
      setSelectedId((current) => (current === id ? null : current));
    },
    [studio],
  );

  // O canvas é quem sabe o tamanho — o hook precisa dele para reposicionar a
  // janela que cresce ao virar pizza/vela.
  const handleChart = useCallback(
    (id: string, chart: ChartKind) => studio.setChart(id, chart, canvasSize),
    [studio, canvasSize],
  );

  const handleSelect = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id) studio.focusWindow(id);
    },
    [studio],
  );

  const handleClear = useCallback(() => {
    studio.clear();
    setSelectedId(null);
  }, [studio]);

  return (
    <div className="space-y-5">
      {/* Cabeçalho de página — mesma gramática das outras rotas do sistema. */}
      <header className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={sidebarOpen ? "Ocultar lista de métricas" : "Mostrar lista de métricas"}
          className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>

        <div className="min-w-0">
          <h1 className="text-[19px] font-extrabold leading-tight tracking-[-0.03em]">Métricas</h1>
          <p className="text-[12px] text-muted-foreground/70">
            {studio.windows.length === 0
              ? "Escolha as métricas que você quer acompanhar"
              : `${studio.windows.length} ${studio.windows.length === 1 ? "janela" : "janelas"} no painel`}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex gap-[2px] rounded-[9px] border border-border bg-card p-[3px]">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] font-semibold transition-all",
                  period === p.key
                    ? "bg-background text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Gauge className="h-3.5 w-3.5" />
            Comando
          </Link>

          <button
            type="button"
            onClick={handleClear}
            disabled={studio.windows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Limpar
          </button>
        </div>
      </header>

      {/* Painel emoldurado: ocupa toda a altura restante da página, medida em
          runtime. Enquanto a medição não chega, cai num piso razoável. */}
      <div
        ref={panelRef}
        style={panelHeight ? { height: panelHeight } : undefined}
        className="flex min-h-[420px] overflow-hidden rounded-xl border border-border/70 bg-card/30"
      >
        {sidebarOpen && (
          <MetricsStudioSidebar openMetricIds={studio.openMetricIds} onAdd={handleAdd} />
        )}

        <div className="min-w-0 flex-1">
          <MetricsCanvas
            ref={canvasRef}
            windows={studio.windows}
            periodKey={period}
            selectedId={selectedId}
            size={canvasSize}
            onSelect={handleSelect}
            onMove={studio.moveWindow}
            onResize={studio.resizeWindow}
            onChart={handleChart}
            onRemove={handleRemove}
          />
        </div>
      </div>
    </div>
  );
}
