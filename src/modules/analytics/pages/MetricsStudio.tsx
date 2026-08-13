import { useCallback, useLayoutEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Download, Gauge, Loader2, Lock, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { cn } from "@/lib/utils";
import { MetricComposer } from "@/modules/analytics/components/metrics-studio/MetricComposer";
import { MetricsCanvas } from "@/modules/analytics/components/metrics-studio/MetricsCanvas";
import { MetricsStudioSidebar } from "@/modules/analytics/components/metrics-studio/MetricsStudioSidebar";
import type { MetricCustomDefinition } from "@/modules/analytics/hooks/useMetricCustomDefinitions";
import { useMetricsStudio } from "@/modules/analytics/hooks/useMetricsStudio";
import { useMetricsStudioEnabled } from "@/modules/analytics/hooks/useMetricsStudioEnabled";
import { useMetricsStudioReport } from "@/modules/analytics/hooks/useMetricsStudioReport";
import { useStudioCatalog } from "@/modules/analytics/hooks/useStudioCatalog";
import type { ChartKind } from "@/modules/analytics/lib/metrics-studio-catalog";
import type { EngineMetric, MetricRecorte } from "@/modules/analytics/lib/metrics-studio-engine-map";
import { STUDIO_PERIODS, type IntervaloCustom, type StudioPeriod } from "@/modules/analytics/lib/metrics-studio-period";
import type { Granularidade } from "@/modules/analytics/lib/metrics-studio-granularidade";
import { useCurrentTeamMember, useFeaturePermission } from "@/modules/identity";

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
 * Números: motor `fn_metric_measure`, via `useMetricWindowData` (SCRUM-310).
 * A lista mostra só o que o motor calcula em produção — G1 do grill.
 */
export default function MetricsStudio() {
  // O catálogo junta o que o motor calcula de fábrica com o que ESTA org
  // compôs (Emenda 1 do ADR-0023). Ele é a fonte de resolução de toda janela —
  // por isso desce para o hook de estado, para o canvas e para o relatório.
  const catalogo = useStudioCatalog();
  const studio = useMetricsStudio(catalogo.byId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compondo, setCompondo] = useState<{ editando: MetricCustomDefinition | null } | null>(null);
  // SCRUM-308. Nasce em Visualização: o painel é para LER. Antes disso, o
  // canvas estava sempre editável e arrastar acontecia por acidente durante a
  // leitura. A lista lateral só existe em Edição — em Visualização ela seria
  // um convite a mexer no que se quer só olhar, e rouba largura do painel.
  const [modo, setModo] = useState<"ver" | "editar">("ver");
  const editando = modo === "editar";
  const [period, setPeriod] = useState<StudioPeriod>("month");
  /**
   * Intervalo do período "Personalizado". Nasce nos últimos 30 dias — um
   * intervalo vazio deixaria a tela sem número até a pessoa preencher as DUAS
   * datas, e a primeira impressão do filtro seria um painel em branco.
   */
  const [intervalo, setIntervalo] = useState<IntervaloCustom>(() => {
    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - 29);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { start: iso(inicio), end: iso(hoje) };
  });

  // G5: trava de liberação por org. Falha para FECHADO — ver o hook.
  const rollout = useMetricsStudioEnabled();
  const relatorio = useMetricsStudioReport(studio.windows, catalogo.byId);

  // G6 do grill: os cortes por pessoa (closer/SDR) reusam a trava do Ranking,
  // que já existe. Sem ela, o seletor de corte simplesmente não os oferece.
  const { allowed: podeVerPorPessoa } = useFeaturePermission("performance.view");

  // Compor métrica é ato de ADMIN DE EQUIPE, e esta linha espelha a RLS letra
  // por letra: `get_my_team_admin_organization_ids()` é
  // `role = 'admin' AND is_active = true`, e mais nada.
  //
  // NÃO usa `useIdentity().isAdmin` nem `effectiveRole`: os dois devolvem
  // 'admin' para MASTER, que não tem policy de escrita nesta tabela (mesma
  // decisão de `metrics_studio_panels`). Master veria o botão e levaria erro na
  // gravação — botão que sempre falha é pior que botão ausente.
  const { data: membroAtual } = useCurrentTeamMember();
  const podeCompor =
    (membroAtual as { role?: string; is_active?: boolean } | null | undefined)?.role === "admin" &&
    (membroAtual as { is_active?: boolean } | null | undefined)?.is_active !== false;

  // ⚠ CALLBACK REF, não `useRef` — e é o conserto de um defeito real.
  //
  // A medição vivia num `useLayoutEffect` com deps `[]` que fazia
  // `if (!canvasRef.current) return`. Só que a página devolve `<TorqueLoader/>`
  // enquanto `rollout.isLoading`: na PRIMEIRA renderização o canvas não está no
  // DOM, o efeito saía fora, e como as deps eram vazias ele NUNCA MAIS rodava.
  // O ResizeObserver jamais era instalado e `canvasSize` ficava {0,0} para
  // sempre.
  //
  // O estrago não era "o canvas não mede": era o REDIMENSIONAR NÃO FUNCIONAR.
  // `MetricWindow.startResize` limita a largura com
  // `clamp(…, MIN_W, Math.max(MIN_W, canvas.width - o.x))` — com `width` zero o
  // teto colapsa no piso e toda janela ficava presa em MIN_W×MIN_H (220×120).
  // O mesmo zero fazia `placeNext` empilhar tudo no canto e as janelas nascerem
  // menores que o `initialSize`.
  //
  // Com callback ref o estado muda QUANDO O NÓ APARECE, e o efeito reage.
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Altura do painel MEDIDA, não chutada. A primeira versão usava
  // `h-[calc(100vh-15rem)]`: 240px fixos contra ~142px de cromo real, o que
  // deixava ~98px de área morta embaixo. E o padding do <main> é responsivo
  // (py-5 sm:py-6 lg:py-8), então qualquer constante erra em algum breakpoint.
  // Aqui o topo do painel é lido do layout e o rodapé respeita o padding real.
  // Mesma armadilha do canvas, mesma correção — o painel também só existe
  // depois que a trava de rollout resolve.
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!panelEl) return;
    const el = panelEl;
    const medir = () => {
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
  }, [panelEl]);

  useLayoutEffect(() => {
    if (!canvasEl) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasSize({ width, height });
    });
    observer.observe(canvasEl);
    return () => observer.disconnect();
  }, [canvasEl]);

  const handleAdd = useCallback(
    (metric: EngineMetric) => studio.addMetric(metric, canvasSize),
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

  const handleCorte = useCallback(
    (id: string, corte: MetricRecorte) => studio.setCorte(id, corte, canvasSize),
    [studio, canvasSize],
  );

  const handleGranularidade = useCallback(
    (id: string, granularidade: Granularidade) => studio.setGranularidade(id, granularidade),
    [studio],
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

  // Excluir métrica personalizada não remove as janelas que a usam: elas param
  // de desenhar (o canvas ignora metricId que não resolve) e voltam sozinhas se
  // a definição for recriada. Apagar janela do painel de OUTRA pessoa a partir
  // daqui seria mexer em estado que não é desta tela.
  const handleRemoverMetrica = useCallback(
    async (def: MetricCustomDefinition) => {
      if (!window.confirm(`Excluir a métrica “${def.name}”? As janelas que a usam deixam de aparecer.`)) return;
      await catalogo.custom.remover(def.id);
    },
    [catalogo.custom],
  );

  if (rollout.isLoading) {
    return <TorqueLoader variant="inline" />;
  }

  if (!rollout.enabled) {
    return <EstudioIndisponivel />;
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho de página — mesma gramática das outras rotas do sistema. */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] font-extrabold leading-tight tracking-[-0.03em]">Métricas</h1>
          <p className="text-[12px] text-muted-foreground/70">
            {editando
              ? "Arraste, redimensione e escolha o corte de cada janela"
              : studio.windows.length === 0
                ? "Monte o painel com as métricas que você acompanha"
                : `${studio.windows.length} ${studio.windows.length === 1 ? "janela" : "janelas"} no painel`}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex gap-[2px] rounded-[9px] border border-border bg-card p-[3px]">
            {STUDIO_PERIODS.map((p) => (
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

          {/* As duas datas só aparecem no modo Personalizado — ocupar a barra o
              tempo todo com campos que não valem para "Mês" seria ruído. O
              limite superior de `start` e o inferior de `end` são o outro
              extremo: o navegador impede o intervalo invertido, então o motor
              nunca recebe `start > end`. */}
          {period === "custom" && (
            <div className="flex items-center gap-1.5 rounded-[9px] border border-border bg-card px-2 py-[5px]">
              <input
                type="date"
                value={intervalo.start}
                max={intervalo.end}
                onChange={(e) => setIntervalo((i) => ({ ...i, start: e.target.value }))}
                aria-label="Início do período"
                className="bg-transparent text-[12px] font-semibold text-foreground outline-none"
              />
              <span className="text-[11px] text-muted-foreground">até</span>
              <input
                type="date"
                value={intervalo.end}
                min={intervalo.start}
                onChange={(e) => setIntervalo((i) => ({ ...i, end: e.target.value }))}
                aria-label="Fim do período"
                className="bg-transparent text-[12px] font-semibold text-foreground outline-none"
              />
            </div>
          )}

          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Gauge className="h-3.5 w-3.5" />
            Comando
          </Link>

          {/* SCRUM-312 · G10: planilha, não PDF. Desabilitado com painel
              vazio — exportar nada gera arquivo que decepciona. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={studio.windows.length === 0 || relatorio.exportando !== null}
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                {relatorio.exportando ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Exportar
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void relatorio.exportar("month")}>
                Relatório mensal
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void relatorio.exportar("quarter")}>
                Relatório trimestral
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={() => {
              setModo(editando ? "ver" : "editar");
              setSelectedId(null);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[9px] px-3 py-[7px] text-[12px] font-semibold transition-colors",
              editando
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {editando ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {editando ? "Concluir" : "Editar"}
          </button>

          {editando && (
          <button
            type="button"
            onClick={handleClear}
            disabled={studio.windows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Limpar
          </button>
          )}
        </div>
      </header>

      {/* Painel emoldurado: ocupa toda a altura restante da página, medida em
          runtime. Enquanto a medição não chega, cai num piso razoável. */}
      <div
        ref={setPanelEl}
        style={panelHeight ? { height: panelHeight } : undefined}
        className="flex min-h-[420px] overflow-hidden rounded-xl border border-border/70 bg-card/30"
      >
        {editando && (
          <MetricsStudioSidebar
            metrics={catalogo.metrics}
            personalizadas={catalogo.personalizadas}
            openMetricIds={studio.openMetricIds}
            podeVerPorPessoa={podeVerPorPessoa}
            podeCompor={podeCompor}
            onAdd={handleAdd}
            onCriar={() => setCompondo({ editando: null })}
            onEditar={(def) => setCompondo({ editando: def })}
            onRemover={(def) => void handleRemoverMetrica(def)}
          />
        )}

        <div className="min-w-0 flex-1">
          <MetricsCanvas
            ref={setCanvasEl}
            windows={studio.windows}
            byId={catalogo.byId}
            period={period}
            intervalo={period === "custom" ? intervalo : null}
            podeVerPorPessoa={podeVerPorPessoa}
            editavel={editando}
            onEditar={() => setModo("editar")}
            selectedId={selectedId}
            size={canvasSize}
            onSelect={handleSelect}
            onMove={studio.moveWindow}
            onResize={studio.resizeWindow}
            onChart={handleChart}
            onCorte={handleCorte}
            onGranularidade={handleGranularidade}
            onRemove={handleRemove}
          />
        </div>
      </div>

      {/* O compositor é remontado a cada abertura (`key`) para nascer com o
          rascunho certo: sem isso, editar uma métrica logo depois de criar
          outra reaproveitaria o estado da anterior. */}
      {compondo && (
        <MetricComposer
          key={compondo.editando?.id ?? "nova"}
          aberto
          period={period}
          editando={compondo.editando}
          salvando={catalogo.custom.salvando}
          onFechar={() => setCompondo(null)}
          onSalvar={async (draft) => {
            if (compondo.editando) await catalogo.custom.atualizar(compondo.editando.id, draft);
            else await catalogo.custom.criar(draft);
          }}
        />
      )}
    </div>
  );
}

/**
 * Org fora do rollout. NÃO é tela de erro nem de permissão negada: a feature
 * existe e está sendo liberada aos poucos. O texto diz isso, em vez de sugerir
 * que o usuário fez algo errado ou que falta plano.
 */
function EstudioIndisponivel() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-2xl border border-dashed border-border/70 p-4">
        <Lock className="h-6 w-6 text-muted-foreground/40" strokeWidth={1.5} />
      </div>
      <div className="max-w-[360px]">
        <p className="text-[14px] font-semibold">Métricas ainda não liberado</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground/70">
          Estamos liberando esta tela aos poucos. Enquanto isso, os números da sua operação
          continuam no Comando.
        </p>
      </div>
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Gauge className="h-3.5 w-3.5" />
        Ir para o Comando
      </Link>
    </div>
  );
}
