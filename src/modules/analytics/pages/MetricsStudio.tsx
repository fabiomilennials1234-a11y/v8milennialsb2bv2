import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChartNoAxesCombined, Check, Download, HeartPulse, Info, LayoutDashboard, LayoutTemplate, Loader2, Map as MapIcon, Pencil, Plus, Trash2, Trophy, type LucideIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { MetricComposer } from "@/modules/analytics/components/metrics-studio/MetricComposer";
import { MetricsCanvas } from "@/modules/analytics/components/metrics-studio/MetricsCanvas";
import { MetricsStudioSidebar } from "@/modules/analytics/components/metrics-studio/MetricsStudioSidebar";
import { StudioTabs } from "@/modules/analytics/components/metrics-studio/StudioTabs";
import { useMetricsStudio } from "@/modules/analytics/hooks/useMetricsStudio";
import { useMetricsStudioPanels, type StudioPanel } from "@/modules/analytics/hooks/useMetricsStudioPanels";
import { useMetricsStudioReport } from "@/modules/analytics/hooks/useMetricsStudioReport";
import { useStudioCatalog } from "@/modules/analytics/hooks/useStudioCatalog";
import { useStudioClock } from "@/modules/analytics/hooks/useStudioClock";
import type { MetricCustomDefinition } from "@/modules/analytics/hooks/useMetricCustomDefinitions";
import type { EngineMetric } from "@/modules/analytics/lib/metrics-studio-engine-map";
import type { StudioWindow } from "@/modules/analytics/lib/metrics-studio-window";
import { isoDaData, STUDIO_PERIODS, type StudioPeriod, type StudioRange } from "@/modules/analytics/lib/metrics-studio-period";
import { studioInterval } from "@/modules/analytics/lib/metrics-studio-interval";
import { mesDeReferencia } from "@/modules/analytics/lib/metrics-studio-mes-referencia";
import templates from "@/modules/analytics/lib/metrics-studio-templates.json";
import { zonedDateParts } from "@/shared/time/zoned-day";
import { useCurrentTeamMember, useFeaturePermission, useIdentity, useOrganization } from "@/modules/identity";
import { notifyError, userMessageOf } from "@/shared/errors";

const Analytics = lazy(() => import("@/modules/analytics/components/dashboard/TabAnalyticsV2").then((m) => ({ default: m.TabAnalyticsV2 })));
const showError = (error: unknown) => notifyError(error, { fallback: "Não foi possível concluir a alteração." });

const ICONE_DO_TEMPLATE: Record<string, LucideIcon> = {
  "visao-geral": LayoutDashboard,
  performance: Trophy,
  saude: HeartPulse,
  mapa: MapIcon,
};

/** Opção do "Criar aba": cartão clicável com o ícone do ponto de partida. */
function OpcaoDeAba({ icon: Icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon }) {
  return (
    <button type="button" {...props}
      className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left text-sm font-semibold transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-foreground/20 hover:shadow-relevo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-foreground/70 transition-colors group-hover:bg-primary-soft group-hover:text-primary-soft-foreground">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      {children}
    </button>
  );
}

/** Comando cuida da operação; aqui vivem os painéis compartilhados da organização. */
export default function MetricsStudio() {
  const catalogo = useStudioCatalog();
  const abas = useMetricsStudioPanels();
  const { organizationId, timezone } = useOrganization();
  const { isMaster } = useIdentity();
  const { data: membro } = useCurrentTeamMember();
  const { allowed: podeVerPorPessoa } = useFeaturePermission("performance.view");
  const podeEditar = membro?.role === "admin" && membro?.is_active !== false;
  const [modo, setModo] = useState<"ver" | "editar">("ver");
  const editando = modo === "editar" && podeEditar;
  const [ativaId, setAtivaId] = useState<string | null>(null);
  const paineisVisiveis = abas.paineis;
  const ativa = paineisVisiveis.find((p) => p.id === ativaId) ?? paineisVisiveis[0] ?? null;
  const studio = useMetricsStudio(catalogo.byId, ativa?.id ?? null);
  const persistence = studio.persistence;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [novaAba, setNovaAba] = useState(false);
  const [remover, setRemover] = useState<StudioPanel | null>(null);
  const [limpar, setLimpar] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [compondo, setCompondo] = useState<{ editando: MetricCustomDefinition | null } | null>(null);
  const [period, setPeriod] = useState<StudioPeriod>("month");
  const [range, setRange] = useState<DateRange>();
  const rangeMotor = range?.from && range?.to ? { from: isoDaData(range.from), to: isoDaData(range.to) } : null;
  const ultimoCompleto = useRef<{ period: StudioPeriod; range: StudioRange | null }>({ period: "month", range: null });
  const incompleto = period === "custom" && !rangeMotor;
  // Guarda também as pontas: editar um intervalo anterior não pode trocar os números por um preset.
  if (!incompleto) ultimoCompleto.current = { period, range: rangeMotor };
  const efetivo = incompleto ? ultimoCompleto.current : { period, range: rangeMotor };
  const relatorio = useMetricsStudioReport(studio.windows, catalogo.byId, efetivo);
  const now = useStudioClock();
  const tz = timezone ?? "UTC";
  const { month, year } = mesDeReferencia(now, tz);
  const { d: day } = zonedDateParts(now, tz);
  const monthlyRange = useMemo(() => studioInterval("month", now, tz),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tz, month, year, day]);
  const intervalo = useMemo(() => studioInterval(efetivo.period, now, tz, efetivo.range),
    // Só a data-calendário muda o intervalo, não os segundos do relógio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [efetivo.period, efetivo.range?.from, efetivo.range?.to, tz, month, year, day]);

  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [height, setHeight] = useState(600);
  const carregando = abas.isLoading || persistence.isLoading;
  const erro = abas.error ?? persistence.error;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const canvas = canvasRef.current;
    if (!panel || !canvas) return;
    const measure = () => {
      setHeight(Math.max(420, window.innerHeight - panel.getBoundingClientRect().top - 24));
      setSize({ width: canvas.clientWidth, height: canvas.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [carregando, erro, editando, ativa?.id]);

  const add = useCallback((metric: EngineMetric) => studio.addMetric(metric, size), [studio, size]);
  const criar = async (template?: typeof templates[number]) => {
    try {
      const id = await abas.criar(template?.nome ?? "Nova aba", template?.layout as StudioWindow[] | undefined, template?.key ?? null);
      if (id) { setAtivaId(id); setSelectedId(null); setNovaAba(false); setModo("editar"); }
    } catch (error) { showError(error); }
  };
  const podeExportar = !!organizationId && !carregando && !erro;
  const rotuloIntervalo = useMemo(() => {
    if (efetivo.period === "month") {
      const txt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: tz }).format(intervalo.start);
      return txt.replace(" de ", " ").replace(/^./, (c) => c.toUpperCase());
    }
    const dia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: tz });
    if (efetivo.period === "today") return dia.format(intervalo.start);
    return `${dia.format(intervalo.start)} – ${dia.format(intervalo.end)}`;
  }, [efetivo.period, intervalo.start, intervalo.end, tz]);


  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="Estúdio de Métricas"
        subtitle={editando ? "Edite as abas e os cards compartilhados com a equipe." : "Os indicadores da organização, no período que você escolher."}
        actions={<>
          {/* V5: "Comando" saiu (está no trilho); exportar vira ícone com o mesmo
              menu; "Editar" é o único primário (ouro) da tela. */}
          {isMaster && <Button variant="outline" onClick={() => setAnalytics(true)}><ChartNoAxesCombined />Analytics avançado</Button>}
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Exportar métricas" disabled={!podeExportar || !!relatorio.exportando} title="Baixar as métricas da aba no período escolhido">
            {relatorio.exportando ? <Loader2 className="animate-spin" /> : <Download />}
          </Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => void relatorio.exportar("selected").catch(showError)}>Período selecionado</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void relatorio.exportar("month").catch(showError)}>Relatório mensal</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void relatorio.exportar("quarter").catch(showError)}>Relatório trimestral</DropdownMenuItem>
          </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
          {podeEditar && <Button onClick={() => { setModo(editando ? "ver" : "editar"); setSelectedId(null); }}>
            {editando ? <Check /> : <Pencil />}{editando ? "Concluir edição" : "Editar"}
          </Button>}
        </>}
        tabs={<StudioTabs paineis={paineisVisiveis} ativoId={ativa?.id ?? null} editavel={editando} podeCriar={podeEditar} podeGerenciar={podeEditar} busy={abas.isPending}
          onSelecionar={(id) => { setAtivaId(id); setSelectedId(null); }}
          onCriar={() => setNovaAba(true)}
          onRenomear={(id, nome) => void abas.renomear(id, nome).catch(showError)}
          onReordenar={(ids) => void abas.reordenar(ids).catch(showError)}
          onRemover={(id) => setRemover(abas.paineis.find((p) => p.id === id) ?? null)} />}
      />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro curto dentro da página: alternador claro (segmented), com a
              semântica de botões pressionados que o filtro sempre teve. */}
          <div role="group" aria-label="Período dos indicadores" className="inline-flex flex-wrap items-center gap-0.5 rounded-full bg-muted p-[3px]">
            {STUDIO_PERIODS.map((item) => {
              const ativo = period === item.key;
              return (
                <button key={item.key} type="button" aria-pressed={ativo} onClick={() => setPeriod(item.key)}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    ativo ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground",
                  )}>
                  {item.label}
                </button>
              );
            })}
          </div>
          {period === "custom" && <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="tabular-nums">
            <CalendarDays />{range?.from && range?.to ? `${format(range.from, "dd/MM/yyyy", { locale: ptBR })} — ${format(range.to, "dd/MM/yyyy", { locale: ptBR })}` : "Escolher as duas datas"}
          </Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={1} locale={ptBR} /></PopoverContent></Popover>}
          {editando && <Button variant="ghost" size="sm" disabled={!studio.windows.length} onClick={() => setLimpar(true)}><Trash2 />Limpar aba</Button>}
          <span role="status" className="text-xs text-muted-foreground">{persistence.isSaving ? "Salvando alterações…" : persistence.saveError ? "Há alterações não salvas" : ""}</span>
          {/* O nome do intervalo em pílula + a explicação num ⓘ (antes era um
              parágrafo de duas linhas sob os filtros). */}
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-input bg-card px-3 text-xs font-semibold tabular-nums shadow-relevo">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            {rotuloIntervalo}
          </span>
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <button type="button" aria-label="O que estes números contam?" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Info className="h-4 w-4" />
            </button>
          </TooltipTrigger><TooltipContent side="bottom" className="max-w-[320px] text-xs leading-relaxed">
            Indicadores da organização no período selecionado. “Leads novos” conta as entradas desse período; os negócios em aberto nos funis incluem períodos anteriores e um lead pode ter mais de um negócio.
          </TooltipContent></Tooltip></TooltipProvider>
        </div>
      </div>

      {persistence.saveError && <Alert variant="destructive" className="rounded-2xl bg-destructive/5"><AlertTitle>O painel não foi salvo</AlertTitle><AlertDescription>
        {persistence.saveError}. Mantenha esta página aberta. <Button variant="outline" size="sm" className="ml-1" onClick={persistence.retrySave} disabled={persistence.isSaving}>Tentar salvar novamente</Button>
      </AlertDescription></Alert>}
      {incompleto && <Alert className="rounded-2xl border-warning/40 bg-warning/10"><AlertTitle>Intervalo incompleto</AlertTitle><AlertDescription className="text-muted-foreground">Escolha a data inicial e a final. Todos os cards continuam no último período completo.</AlertDescription></Alert>}

      {erro ? <Alert variant="destructive" className="rounded-2xl bg-destructive/5"><AlertTitle>Não foi possível carregar o painel</AlertTitle><AlertDescription>{userMessageOf(erro, "Não foi possível carregar o painel.")}
        <Button variant="outline" size="sm" className="ml-1" onClick={() => { abas.refetch(); persistence.refetch(); }}>Tentar novamente</Button>
      </AlertDescription></Alert> : carregando ? <TorqueLoader variant="inline" /> : (
        // Visualização: os cards pousam direto na bancada, como um bento — a
        // margem negativa alinha o respiro de 16px do canvas com a borda da
        // página. Edição: o painel vira uma mesa de trabalho emoldurada, com o
        // catálogo ao lado e a malha de encaixe à mostra.
        <div ref={panelRef} id="studio-panel" role="tabpanel" aria-labelledby={ativa ? `studio-tab-${ativa.id}` : undefined}
          aria-label={ativa ? undefined : "Painel de métricas"} style={{ height }}
          className={cn(
            "flex min-h-[420px] min-w-0 flex-col overflow-hidden sm:flex-row",
            editando ? "rounded-panel border border-card-border bg-card shadow-relevo" : "-mx-4",
          )}>
          {editando && ativa && <MetricsStudioSidebar metrics={catalogo.metrics} personalizadas={catalogo.personalizadas} openMetricIds={studio.openMetricIds}
            podeVerPorPessoa={podeVerPorPessoa} podeCompor={podeEditar} onAdd={add} onAddFixed={(id, dimensions) => studio.addFixed(id, dimensions, size)}
            onCriar={() => setCompondo({ editando: null })} onEditar={(def) => setCompondo({ editando: def })}
            onRemover={(def) => { if (window.confirm(`Excluir a métrica “${def.name}”?`)) void catalogo.custom.remover(def.id).catch(showError); }} />}
          <div className="min-h-0 min-w-0 flex-1">
            {!ativa ? <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground"><LayoutTemplate className="h-5 w-5" aria-hidden /></span>
              <p className="text-sm font-semibold">Nenhuma aba nesta organização.</p>
              {podeEditar ? <Button onClick={() => setNovaAba(true)}><Plus />Criar uma aba</Button> : <p className="text-[13px] text-muted-foreground">Um administrador pode criar abas a partir dos templates.</p>}</div> :
              <MetricsCanvas ref={canvasRef} fillWidth={!!ativa.templateKey} windows={studio.windows} byId={catalogo.byId} intervalo={intervalo} monthlyRange={monthlyRange} month={month} year={year}
                period={efetivo.period} range={efetivo.range} podeVerPorPessoa={podeVerPorPessoa} editavel={editando} podeEditar={podeEditar}
                onEditar={() => setModo("editar")} selectedId={selectedId} size={size} onSelect={(id) => { setSelectedId(id); if (id && editando) studio.focusWindow(id); }}
                onMove={studio.moveWindow} onResize={studio.resizeWindow} onChart={(id, chart) => studio.setChart(id, chart, size)}
                onCorte={(id, corte) => studio.setCorte(id, corte, size)} onRemove={studio.removeWindow} />}
          </div>
        </div>
      )}

      <Dialog open={novaAba && podeEditar} onOpenChange={setNovaAba}><DialogContent><DialogHeader><DialogTitle>Criar aba</DialogTitle><DialogDescription>Comece do zero ou com um dashboard. A cópia pode ser editada livremente.</DialogDescription></DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          <OpcaoDeAba icon={Plus} disabled={abas.isPending} onClick={() => void criar()}>Aba em branco</OpcaoDeAba>
          {templates.map((template) => <OpcaoDeAba key={template.key} icon={ICONE_DO_TEMPLATE[template.key] ?? LayoutTemplate} disabled={abas.isPending} onClick={() => void criar(template)}>{template.nome}</OpcaoDeAba>)}
        </div>
      </DialogContent></Dialog>
      <AlertDialog open={podeEditar && (!!remover || limpar)} onOpenChange={(open) => { if (!open) { setRemover(null); setLimpar(false); } }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{limpar ? `Limpar “${ativa?.nome}”?` : `Excluir “${remover?.nome}”?`}</AlertDialogTitle>
          <AlertDialogDescription>Os cards desta aba serão removidos para toda a organização. As outras abas não mudam. Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction disabled={abas.isPending || persistence.isSaving} onClick={(event) => {
            if (limpar) { studio.clear(); setLimpar(false); return; }
            if (!remover) return;
            event.preventDefault();
            const id = remover.id;
            void abas.remover(id).then(() => { persistence.discardPanel(id); setRemover(null); if (ativa?.id === id) setAtivaId(null); }).catch(showError);
          }}>{limpar ? "Limpar aba" : "Excluir aba"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {podeEditar && compondo && <MetricComposer key={compondo.editando?.id ?? "nova"} aberto period={efetivo.period} range={efetivo.range}
        editando={compondo.editando} salvando={catalogo.custom.salvando} onFechar={() => setCompondo(null)}
        onSalvar={async (draft) => { if (compondo.editando) await catalogo.custom.atualizar(compondo.editando.id, draft); else await catalogo.custom.criar(draft); }} />}
      {isMaster && <Dialog open={analytics} onOpenChange={setAnalytics}><DialogContent className="max-h-[90vh] max-w-[95vw] overflow-auto">
        <DialogHeader><DialogTitle>Analytics avançado</DialogTitle><DialogDescription>Visão master. Os filtros deste relatório são independentes do painel.</DialogDescription></DialogHeader>
        <Suspense fallback={<TorqueLoader variant="inline" />}><Analytics /></Suspense>
      </DialogContent></Dialog>}
    </div>
  );
}
