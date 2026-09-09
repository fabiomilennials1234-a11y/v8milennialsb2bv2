import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Check, Download, Gauge, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

const Analytics = lazy(() => import("@/modules/analytics/components/dashboard/TabAnalyticsV2").then((m) => ({ default: m.TabAnalyticsV2 })));
const showError = (error: unknown) => toast.error(error instanceof Error ? error.message : "Não foi possível concluir a alteração");

/** Comando cuida da operação; aqui vivem os painéis compartilhados da organização. */
export default function MetricsStudio() {
  const catalogo = useStudioCatalog();
  const abas = useMetricsStudioPanels();
  const { timezone } = useOrganization();
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
  const relatorio = useMetricsStudioReport(studio.windows, catalogo.byId);
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
  const podeExportar = studio.windows.some((win) => !win.fixo && catalogo.byId.has(win.metricId));


  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-bold tracking-tight">Estúdio de Métricas</h1>
          <p className="text-sm text-muted-foreground">{editando ? "Edite as abas e os cards compartilhados com a equipe." : "Os indicadores da organização, no período que você escolher."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="min-h-11"><Link to="/dashboard"><Gauge className="mr-2 size-4" />Comando</Link></Button>
          {isMaster && <Button variant="outline" className="min-h-11" onClick={() => setAnalytics(true)}>Analytics avançado</Button>}
          {podeEditar && <Button variant={editando ? "default" : "outline"} className="min-h-11" onClick={() => { setModo(editando ? "ver" : "editar"); setSelectedId(null); }}>
            {editando ? <Check className="mr-2 size-4" /> : <Pencil className="mr-2 size-4" />}{editando ? "Concluir edição" : "Editar"}
          </Button>}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Período dos indicadores" className="flex flex-wrap gap-1">
          {STUDIO_PERIODS.map((item) => <Button key={item.key} variant={period === item.key ? "secondary" : "ghost"} aria-pressed={period === item.key} className="min-h-11" onClick={() => setPeriod(item.key)}>{item.label}</Button>)}
        </div>
        {period === "custom" && <Popover><PopoverTrigger asChild><Button variant="outline" className="min-h-11">
          <CalendarDays className="mr-2 size-4" />{range?.from && range?.to ? `${format(range.from, "dd/MM/yyyy", { locale: ptBR })} — ${format(range.to, "dd/MM/yyyy", { locale: ptBR })}` : "Escolher as duas datas"}
        </Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={1} locale={ptBR} /></PopoverContent></Popover>}
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="min-h-11" disabled={!podeExportar || !!relatorio.exportando} title="Exporta as métricas do motor; cards de dashboard não entram na planilha">
          {relatorio.exportando ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}Exportar métricas
        </Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void relatorio.exportar("month").catch(showError)}>Relatório mensal</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void relatorio.exportar("quarter").catch(showError)}>Relatório trimestral</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
        {editando && <Button variant="ghost" disabled={!studio.windows.length} className="min-h-11" onClick={() => setLimpar(true)}><Trash2 className="mr-2 size-4" />Limpar aba</Button>}
        <span role="status" className="text-xs text-muted-foreground">{persistence.isSaving ? "Salvando alterações…" : persistence.saveError ? "Há alterações não salvas" : ""}</span>
      </div>

      {persistence.saveError && <Alert variant="destructive"><AlertTitle>O painel não foi salvo</AlertTitle><AlertDescription>
        {persistence.saveError}. Mantenha esta página aberta. <Button variant="outline" onClick={persistence.retrySave} disabled={persistence.isSaving}>Tentar salvar novamente</Button>
      </AlertDescription></Alert>}
      {incompleto && <Alert><AlertTitle>Intervalo incompleto</AlertTitle><AlertDescription>Escolha a data inicial e a final. Todos os cards continuam no último período completo.</AlertDescription></Alert>}
      <StudioTabs paineis={paineisVisiveis} ativoId={ativa?.id ?? null} editavel={editando} podeCriar={podeEditar} podeGerenciar={podeEditar} busy={abas.isPending}
        onSelecionar={(id) => { setAtivaId(id); setSelectedId(null); }}
        onCriar={() => setNovaAba(true)}
        onRenomear={(id, nome) => void abas.renomear(id, nome).catch(showError)}
        onReordenar={(ids) => void abas.reordenar(ids).catch(showError)}
        onRemover={(id) => setRemover(abas.paineis.find((p) => p.id === id) ?? null)} />

      {erro ? <Alert variant="destructive"><AlertTitle>Não foi possível carregar o painel</AlertTitle><AlertDescription>{erro.message}
        <Button variant="outline" onClick={() => { abas.refetch(); persistence.refetch(); }}>Tentar novamente</Button>
      </AlertDescription></Alert> : carregando ? <TorqueLoader variant="inline" /> : (
        <div ref={panelRef} id="studio-panel" role="tabpanel" aria-labelledby={ativa ? `studio-tab-${ativa.id}` : undefined}
          aria-label={ativa ? undefined : "Painel de métricas"} style={{ height }} className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border bg-card sm:flex-row">
          {editando && ativa && <MetricsStudioSidebar metrics={catalogo.metrics} personalizadas={catalogo.personalizadas} openMetricIds={studio.openMetricIds}
            podeVerPorPessoa={podeVerPorPessoa} podeCompor={podeEditar} onAdd={add} onAddFixed={(id, dimensions) => studio.addFixed(id, dimensions, size)}
            onCriar={() => setCompondo({ editando: null })} onEditar={(def) => setCompondo({ editando: def })}
            onRemover={(def) => { if (window.confirm(`Excluir a métrica “${def.name}”?`)) void catalogo.custom.remover(def.id).catch(showError); }} />}
          <div className="min-h-0 min-w-0 flex-1">
            {!ativa ? <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center"><p>Nenhuma aba nesta organização.</p>
              {podeEditar ? <Button onClick={() => setNovaAba(true)}><Plus className="mr-2 size-4" />Criar uma aba</Button> : <p className="text-sm text-muted-foreground">Um administrador pode criar abas a partir dos templates.</p>}</div> :
              <MetricsCanvas ref={canvasRef} fillWidth={!!ativa.templateKey} windows={studio.windows} byId={catalogo.byId} intervalo={intervalo} monthlyRange={monthlyRange} month={month} year={year}
                period={efetivo.period} range={efetivo.range} podeVerPorPessoa={podeVerPorPessoa} editavel={editando} podeEditar={podeEditar}
                onEditar={() => setModo("editar")} selectedId={selectedId} size={size} onSelect={(id) => { setSelectedId(id); if (id && editando) studio.focusWindow(id); }}
                onMove={studio.moveWindow} onResize={studio.resizeWindow} onChart={(id, chart) => studio.setChart(id, chart, size)}
                onCorte={(id, corte) => studio.setCorte(id, corte, size)} onRemove={studio.removeWindow} />}
          </div>
        </div>
      )}

      <Dialog open={novaAba && podeEditar} onOpenChange={setNovaAba}><DialogContent><DialogHeader><DialogTitle>Criar aba</DialogTitle><DialogDescription>Comece do zero ou com um dashboard. A cópia pode ser editada livremente.</DialogDescription></DialogHeader>
        <div className="grid gap-2"><Button variant="outline" disabled={abas.isPending} onClick={() => void criar()}>Aba em branco</Button>
          {templates.map((template) => <Button key={template.key} variant="outline" disabled={abas.isPending} onClick={() => void criar(template)}>{template.nome}</Button>)}
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
