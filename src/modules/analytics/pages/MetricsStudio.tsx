import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Check, Download, Gauge, Loader2, Lock, Pencil, Trash2 } from "lucide-react";
import type { DateRange } from "react-day-picker";
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  isoDaData,
  STUDIO_PERIODS,
  type StudioPeriod,
} from "@/modules/analytics/lib/metrics-studio-period";
import { useCurrentTeamMember, useFeaturePermission, useOrganization } from "@/modules/identity";
import { computePeriodRange } from "@/modules/analytics/hooks/useCommandMetrics";

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
  const [period, setPeriod] = useState<StudioPeriod>("month");

  // SCRUM-313. O seletor guarda `Date` porque é o que o calendário fala; a
  // conversão para data de calendário acontece na BORDA, em `rangeMotor`, e
  // nada abaixo daqui volta a ver um instante.
  const [range, setRange] = useState<DateRange | undefined>();
  const rangeMotor =
    range?.from && range?.to
      ? { from: isoDaData(range.from), to: isoDaData(range.to) }
      : null;
  const { timezone } = useOrganization();

  /**
   * Intervalo CONCRETO, para os cards sob medida.
   *
   * Reusa `computePeriodRange` — o mesmo helper que o Comando já usa para
   * alimentar `RankingPodium`, `ProductChampions` e companhia. Não é
   * conveniência: escrever a expansão aqui faria a semana começar no domingo
   * (JS `getDay()`) contra a SEGUNDA do motor (`date_trunc('week')`), e usaria
   * o fuso do browser contra `organizations.timezone`. Card sob medida e card
   * de métrica, lado a lado, mediriam períodos diferentes sem levantar erro.
   *
   * `StudioPeriod` e `CommandPeriod` são o mesmo conjunto de literais
   * (`today|week|month|quarter|custom`), então não há tradução no meio — o que
   * elimina a outra forma de errar isto.
   *
   * Mês e ano do "agora" porque o Estúdio não tem seletor de mês como o
   * Comando: aqui o período é sempre relativo a hoje.
   */
  const agora = new Date();
  const intervalo = useMemo(
    () =>
      computePeriodRange(
        period,
        agora.getMonth(),
        agora.getFullYear(),
        range?.from && range?.to ? { from: range.from, to: range.to } : null,
        timezone ?? undefined,
      ),
    // `agora` fora das dependências de propósito: entra como valor a cada
    // render e só serve de âncora. Incluí-lo recalcularia o intervalo sem parar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, range?.from, range?.to, timezone],
  );

  // `custom` sem as duas pontas NÃO mede o intervalo. Chutar um período
  // mostraria um número plausível de algo que ninguém pediu — o pior erro
  // possível numa tela de métrica.
  const periodoIncompleto = period === "custom" && rangeMotor === null;

  // O que o painel mede enquanto o intervalo está pela metade: o último preset
  // COMPLETO que o usuário viu. Guardado aqui porque `period` já virou
  // "custom" no clique, e voltar a um "mês" fixo faria o número saltar sem
  // motivo visível para quem estava olhando trimestre.
  const ultimoPeriodoCompletoRef = useRef<StudioPeriod>("month");
  if (period !== "custom") ultimoPeriodoCompletoRef.current = period;
  const ultimoPeriodoCompleto = ultimoPeriodoCompletoRef.current;

  // G5: trava de liberação por org. Falha para FECHADO — ver o hook.
  const rollout = useMetricsStudioEnabled();
  const relatorio = useMetricsStudioReport(studio.windows, catalogo.byId);

  // G6 do grill: os cortes por pessoa (closer/SDR) reusam a trava do Ranking,
  // que já existe. Sem ela, o seletor de corte simplesmente não os oferece.
  const { allowed: podeVerPorPessoa } = useFeaturePermission("performance.view");

  // Compor métrica é ato de ADMIN DE EQUIPE **ou de MASTER**, e esta linha
  // espelha as policies de `metric_custom_definitions`:
  //   - tenant: `get_my_team_admin_organization_ids()` = `role = 'admin' AND is_active`
  //   - master: `master_ghost_all_metric_custom_definitions` (mig. 20270824100000)
  //
  // ⚠️ HISTÓRIA QUE ESTE COMENTÁRIO JÁ CONTOU ERRADO. A versão anterior dizia
  // que usar `useCurrentTeamMember()` — em vez de `useIdentity().isAdmin` —
  // evitava mostrar o botão para master. Não evitava: para master,
  // `useCurrentTeamMember` devolve um TEAM MEMBER VIRTUAL montado no cliente,
  // com `role: "admin", is_active: true` (`useCurrentTeamMember.ts:60-63`). Os
  // dois caminhos diziam 'admin'. O resultado era o botão aparecer e a gravação
  // morrer em "new row violates row-level security policy" — exatamente o que o
  // comentário afirmava estar prevenindo.
  //
  // A correção foi no BANCO (dar ao master a policy que ele não tinha), não
  // aqui: master é quem configura org de cliente, e sem policy ele nem LISTAVA
  // as personalizadas. Por isso esta expressão continua valendo para o membro
  // virtual — hoje ela é verdadeira e o banco concorda.
  //
  // 🔴 `metrics_studio_panels` NÃO foi corrigida junto e ainda barra o master:
  // a policy exige `team_member_id IN get_my_team_member_ids()`, e o id virtual
  // (`master-virtual-*`) não é uuid de `team_members`. Salvar painel como master
  // continua falhando. Está fora do escopo desta correção, de propósito.
  const { data: membroAtual } = useCurrentTeamMember();
  const podeCompor =
    (membroAtual as { role?: string; is_active?: boolean } | null | undefined)?.role === "admin" &&
    (membroAtual as { is_active?: boolean } | null | undefined)?.is_active !== false;

  /**
   * Quem pode EDITAR o painel da organização — decisão do CTO em 2026-08-25:
   * só admin de equipe e master; todo o resto visualiza.
   *
   * Espelha a RLS de `metrics_studio_panels` (mig. 20270828000010): escrita por
   * `get_my_team_admin_organization_ids()` mais a policy própria do master.
   * `podeCompor` já vale `true` para master, porque o team member VIRTUAL que
   * `useCurrentTeamMember` monta para ele diz `role: 'admin'` — a mesma
   * expressão serve para as duas coisas, e é por isso que não há um `|| isMaster`
   * aqui.
   *
   * ⚠️ ISTO É COSMÉTICO. A barreira real é a RLS: esconder botão não protege
   * nada contra quem chama o PostgREST direto. O valor daqui é não oferecer ao
   * membro um controle que o banco vai recusar.
   */
  const podeEditar = podeCompor;

  // `podeEditar` entra na DERIVAÇÃO do modo, não só no botão. Se ele virar
  // false com "editar" já ligado — troca de org, membro perde admin, master
  // saindo do ghost —, o canvas volta a travar no MESMO render, sem depender de
  // alguém clicar em "Concluir". Mora aqui, e não junto do `useState`, porque
  // depende de `useCurrentTeamMember`, que é resolvido acima.
  const editando = modo === "editar" && podeEditar;

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

  const handleSelect = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id) studio.focusWindow(id);
    },
    [studio],
  );

  // Desde que o painel virou DA ORGANIZAÇÃO, "Limpar" não apaga a tela de quem
  // clica: apaga a de todo mundo da org, sem desfazer e sem histórico. O botão
  // fica encostado no "Concluir" no modo Edição — pedir confirmação é o mínimo.
  // Mesmo idioma de `handleRemoverMetrica`, logo abaixo.
  const handleClear = useCallback(() => {
    if (
      !window.confirm(
        "Limpar o painel da organização? As janelas somem para todos os membros e não há como desfazer.",
      )
    ) {
      return;
    }
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
            {/* Painel vazio diz coisas DIFERENTES conforme quem olha: mandar o
                membro "montar o painel" seria instrução que ele não tem como
                seguir — o botão de edição nem existe para ele. */}
            {editando
              ? "Arraste, redimensione e escolha o corte de cada janela"
              : studio.windows.length === 0
                ? podeEditar
                  ? "Monte o painel da organização com as métricas que o time acompanha"
                  : "O painel da organização ainda não foi montado — um administrador precisa configurá-lo"
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

          {/* SCRUM-313. Mesma gramática do cabeçalho do Comando — o usuário não
              deve perceber que são duas telas. O que NÃO se copia de lá é a
              conta: o Comando recorta o intervalo no cliente com startOfUTCDay,
              e aqui as datas seguem CRUAS para o servidor cortar na timezone da
              org. Ver o comentário de `StudioRange`. */}
          {period === "custom" && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-[7px] rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold transition-colors",
                    range?.from
                      ? "text-foreground hover:border-primary/50"
                      : "text-muted-foreground hover:text-foreground hover:border-border",
                  )}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  {range?.from && range?.to
                    ? `${format(range.from, "dd MMM", { locale: ptBR })} — ${format(range.to, "dd MMM", { locale: ptBR })}`
                    : range?.from
                      ? `${format(range.from, "dd MMM", { locale: ptBR })} — ...`
                      : "Selecionar intervalo"}
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto border-border/60 p-0 shadow-lg dark:bg-popover dark:shadow-black/40"
                align="end"
              >
                <Calendar
                  mode="range"
                  selected={range}
                  onSelect={setRange}
                  numberOfMonths={2}
                  locale={ptBR}
                  defaultMonth={range?.from}
                />
              </PopoverContent>
            </Popover>
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

          {/* Só admin de equipe e master editam o painel da organização. Para o
              resto o botão NÃO aparece — em vez de aparecer desabilitado.
              Controle morto na tela é promessa que o produto não cumpre; a
              ausência diz a mesma coisa sem prometer nada. */}
          {podeEditar && (
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
          )}

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
        ref={panelRef}
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
          {periodoIncompleto && (
            <div className="mb-3 flex items-center gap-2 rounded-[9px] border border-dashed border-border bg-card/50 px-3 py-2 text-[12px] text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span>
                Escolha as duas datas do intervalo para o painel medir. Enquanto
                falta uma ponta, as janelas seguem no último período válido —
                não inventamos um intervalo por você.
              </span>
            </div>
          )}
          <MetricsCanvas
            ref={canvasRef}
            windows={studio.windows}
            byId={catalogo.byId}
            intervalo={intervalo}
            // Com o intervalo pela metade, o painel segue medindo o último
            // período COMPLETO — o que o usuário via antes de clicar em
            // "Escolher", não um "mês" chutado. O aviso acima diz o que está
            // acontecendo; número que muda sem explicação seria pior.
            period={periodoIncompleto ? ultimoPeriodoCompleto : period}
            range={rangeMotor}
            podeVerPorPessoa={podeVerPorPessoa}
            editavel={editando}
            podeEditar={podeEditar}
            onEditar={() => setModo("editar")}
            selectedId={selectedId}
            size={canvasSize}
            onSelect={handleSelect}
            onMove={studio.moveWindow}
            onResize={studio.resizeWindow}
            onChart={handleChart}
            onCorte={handleCorte}
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
          period={periodoIncompleto ? ultimoPeriodoCompleto : period}
          range={rangeMotor}
          
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
