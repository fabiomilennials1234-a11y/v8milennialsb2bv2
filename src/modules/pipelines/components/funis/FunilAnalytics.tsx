/**
 * FunilAnalytics — o viewMode Analytics da página unificada `/funil/:slug`
 * (SCRUM-637, porte dos painéis que viviam dentro das 3 páginas de sistema).
 *
 * Parametrizado pelo `kind` que `useFunilMetrics` resolve:
 *   · `whatsapp`    → painel de saúde do funil (PipeWhatsappAnalytics);
 *   · `confirmacao` → painel de comparecimento (PipeConfirmacaoAnalytics);
 *   · `propostas`   → stat-cards + drilldown + abas Propostas/Produtos — o
 *                     porte 1:1 do bloco do PipePropostas, com won/aberto
 *                     resolvidos por `stage_role` (não por slug de etapa);
 *   · `generic`     → funil custom ganha cabeçalho de métricas que nunca teve:
 *                     total/abertos/ganhos/perdidos/conversão, do motor único
 *                     `get_pipeline_stage_counts_by_id` (SCRUM-633).
 *
 * Dados que só existem para os 3 slugs (saúde de coorte, no-show, MRR/projeto,
 * drilldown de venda) aparecem QUANDO disponíveis e são omitidos nos demais —
 * documentado no relatório da fatia. As agregações client-side (vendas
 * recentes, produtos) leem os itens CARREGADOS — mesmo recorte que as páginas
 * velhas paginadas liam.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  Package,
  Briefcase,
  CircleDot,
  Trophy,
  CircleX,
  Percent,
  CircleDollarSign,
  Repeat,
} from "lucide-react";
import { IconChip, KpiRow } from "@/components/ui/bento";
import { useWinLossAnalysis } from "@/modules/analytics";
import { useLossReasons } from "@/modules/pipelines/hooks/config/useLossReasons";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { CustomPipelineStage, StageRole } from "@/contracts/pipe";
import type { DateRange } from "@/lib/metrics-period";
import type { Pipeline } from "@/modules/pipelines/hooks/model/usePipelines";
import type { StageData } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import type { FunilMetrics } from "@/modules/pipelines/hooks/config/useFunilMetrics";
import {
  AnalyticsPanel,
  AnalyticsStatCard,
  ContinuousFunnel,
  MemberLeaderboard,
} from "@/modules/pipelines/components/shared/analytics-ui";
import { PipeWhatsappAnalytics } from "@/modules/pipelines/components/shared/PipeWhatsappAnalytics";
import { PipeConfirmacaoAnalytics } from "@/modules/pipelines/components/shared/PipeConfirmacaoAnalytics";
import { ProductAnalyticsChart } from "@/modules/carteira/components/proposal/ProductAnalyticsChart";
import { useMetricDrilldown, type MetricType } from "@/modules/carteira/hooks/useMetricDrilldown";
import { MetricDrilldownSheet } from "@/modules/carteira/components/proposal/MetricDrilldownSheet";
import { useLeadSheet } from "@/modules/leads";

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function formatPeriodLabel(range: { startStr: string; endStr: string }): string {
  const [sy, sm, sd] = range.startStr.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = range.endStr.slice(0, 10).split("-").map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${MONTHS_PT[sm - 1]} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  return `${sd} ${MONTHS_PT[sm - 1]} ${sy} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(value);

const roleDe = (s: CustomPipelineStage): StageRole => s.stage_role ?? "open";

interface FunilAnalyticsProps {
  pipeline: Pipeline;
  stages: CustomPipelineStage[];
  stageData: Record<string, StageData>;
  /** Itens CARREGADOS (todas as colunas) — mesmo recorte das páginas velhas. */
  allItems: any[];
  metrics: FunilMetrics;
  periodRange: DateRange | null;
  responsibleMembers: { id: string; name: string }[];
}

export function FunilAnalytics({
  pipeline,
  stages,
  stageData,
  allItems,
  metrics,
  periodRange,
  responsibleMembers,
}: FunilAnalyticsProps) {
  if (metrics.kind === "whatsapp") {
    return (
      <WhatsappBlock
        allItems={allItems}
        periodRange={periodRange}
        responsibleMembers={responsibleMembers}
      />
    );
  }
  if (metrics.kind === "confirmacao") {
    return (
      <ConfirmacaoBlock
        allItems={allItems}
        periodRange={periodRange}
        responsibleMembers={responsibleMembers}
      />
    );
  }
  if (metrics.kind === "propostas") {
    return (
      <PropostasBlock
        pipeline={pipeline}
        stages={stages}
        stageData={stageData}
        allItems={allItems}
        metrics={metrics}
        periodRange={periodRange}
        responsibleMembers={responsibleMembers}
      />
    );
  }
  return <GenericBlock metrics={metrics} stages={stages} periodRange={periodRange} />;
}

// ── Genérico: o cabeçalho que funil custom nunca teve (SCRUM-633) ───────────

function GenericBlock({
  metrics,
  stages,
  periodRange,
}: {
  metrics: FunilMetrics;
  stages: CustomPipelineStage[];
  periodRange: DateRange | null;
}) {
  const g = metrics.generic;
  if (!g) return null;
  // Contagem por etapa vem do motor (`get_pipeline_stage_counts_by_id`) — o
  // funil inteiro, não só os cards carregados. Perda fica fora das barras: ela
  // tem o próprio cartão (motivos).
  const funnelStages = stages
    .filter((s) => roleDe(s) !== "lost")
    .map((s) => ({
      key: s.stage_key,
      label: s.name,
      count: g.byStageKey[s.stage_key] ?? 0,
      tone: roleDe(s) === "won" ? ("gold" as const) : undefined,
    }));
  return (
    <div className="space-y-4">
      <KpiRow cols={5}>
        <AnalyticsStatCard label="Negócios" value={String(g.total)} sub="no recorte" accent="blue" icon={Briefcase} />
        <AnalyticsStatCard label="Em aberto" value={String(g.openCount)} sub="etapas abertas" accent="neutral" icon={CircleDot} delay={0.05} />
        <AnalyticsStatCard label="Ganhos" value={String(g.wonCount)} sub="etapas de ganho" accent="success" tintValue icon={Trophy} delay={0.1} />
        <AnalyticsStatCard label="Perdidos" value={String(g.lostCount)} sub="etapas de perda" accent="neutral" tone="bad" icon={CircleX} delay={0.15} />
        <AnalyticsStatCard
          label="Conversão"
          value={`${g.conversionRate.toFixed(1)}%`}
          sub="ganhos / total"
          accent="gold"
          tintValue
          icon={Percent}
          delay={0.2}
        />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <AnalyticsPanel title="Funil" subtitle="Negócios por etapa · passagem entre etapas">
          <ContinuousFunnel unit="negócios" stages={funnelStages} />
        </AnalyticsPanel>
        <LossReasonsPanel periodRange={periodRange} />
      </div>
    </div>
  );
}

/** "sem_budget" → "Sem budget" quando a org não tem o motivo cadastrado. */
function humanizeSlug(slug: string): string {
  const t = slug.replace(/[_-]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "Sem motivo";
}

/**
 * Motivos de perda — DA ORGANIZAÇÃO (decisão do líder): `get_win_loss_analysis`
 * não recorta por funil, então o cartão diz isso no subtítulo em vez de
 * fingir que é deste funil. Nomes vêm do cadastro de motivos da org.
 */
function LossReasonsPanel({ periodRange }: { periodRange: DateRange | null }) {
  const { start, end, label } = useMemo(() => {
    if (periodRange) {
      return { start: periodRange.startStr, end: periodRange.endStr, label: formatPeriodLabel(periodRange) };
    }
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 86_400_000);
    return { start: from.toISOString(), end: now.toISOString(), label: "últimos 30 dias" };
  }, [periodRange]);
  const { data: losses = [], isLoading } = useWinLossAnalysis(start, end);
  const { data: reasons = [] } = useLossReasons();

  const rows = useMemo(() => {
    const nameBySlug = new Map((reasons as { slug?: string; name?: string }[]).map((r) => [r.slug, r.name]));
    const list = losses
      .map((l) => ({ key: l.loss_reason, label: nameBySlug.get(l.loss_reason) ?? humanizeSlug(l.loss_reason ?? ""), count: l.count }))
      .sort((a, b) => b.count - a.count);
    const total = list.reduce((acc, l) => acc + l.count, 0);
    return { list: list.slice(0, 6), total };
  }, [losses, reasons]);

  return (
    <AnalyticsPanel title="Motivos de perda" subtitle={`Da organização · ${label}`}>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-6 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : rows.list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          Nenhuma perda registrada no período
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[1.65rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums">
            {rows.total.toLocaleString("pt-BR")}
            <span className="ml-1.5 text-xs font-semibold tracking-normal text-muted-foreground">perdidos</span>
          </p>
          <ul className="space-y-2.5">
            {rows.list.map((r) => {
              const pct = rows.total > 0 ? (r.count / rows.total) * 100 : 0;
              return (
                <li key={r.key} className="space-y-1">
                  <div className="flex items-baseline gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate font-semibold">{r.label}</span>
                    <span className="font-bold tabular-nums">{r.count}</span>
                    <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-destructive/70" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </AnalyticsPanel>
  );
}

// ── Qualificação ────────────────────────────────────────────────────────────

function WhatsappBlock({
  allItems,
  periodRange,
  responsibleMembers,
}: Pick<FunilAnalyticsProps, "allItems" | "periodRange" | "responsibleMembers">) {
  const healthRange = useMemo(() => {
    if (periodRange) {
      return { start: new Date(periodRange.startStr), end: new Date(periodRange.endStr) };
    }
    return { start: new Date("2015-01-01T00:00:00Z"), end: new Date() };
  }, [periodRange]);

  const analyticsItems = useMemo(() => {
    if (!periodRange) return allItems;
    return allItems.filter(
      (it) => it.created_at && it.created_at >= periodRange.startStr && it.created_at <= periodRange.endStr,
    );
  }, [allItems, periodRange]);

  return (
    <PipeWhatsappAnalytics
      items={analyticsItems}
      range={healthRange}
      responsibleMembers={responsibleMembers}
    />
  );
}

// ── Confirmação ─────────────────────────────────────────────────────────────

function ConfirmacaoBlock({
  allItems,
  periodRange,
  responsibleMembers,
}: Pick<FunilAnalyticsProps, "allItems" | "periodRange" | "responsibleMembers">) {
  const statsData = useMemo(() => {
    if (!periodRange) return allItems;
    const startMs = new Date(periodRange.startStr).getTime();
    const endMs = new Date(periodRange.endStr).getTime();
    return allItems.filter((item: any) => {
      const at = item.metrics_period_at
        ? new Date(item.metrics_period_at).getTime()
        : new Date(item.created_at).getTime();
      return at >= startMs && at <= endMs;
    });
  }, [allItems, periodRange]);

  return <PipeConfirmacaoAnalytics items={statsData} responsibleMembers={responsibleMembers} />;
}

// ── Propostas: stat-cards + drilldown + abas (porte por stage_role) ─────────

function PropostasBlock({
  pipeline,
  stages,
  stageData,
  allItems,
  metrics,
  periodRange,
  responsibleMembers,
}: FunilAnalyticsProps) {
  const [drilldownMetric, setDrilldownMetric] = useState<MetricType | null>(null);
  const { openLead } = useLeadSheet();

  // won/aberto por PAPEL, não por slug de etapa — funil com etapa renomeada
  // continua contando (R2). Fallback pré-governança: is_final_* como as
  // páginas velhas usavam.
  const wonKeys = useMemo(
    () =>
      new Set(
        stages
          .filter((s) => roleDe(s) === "won" || (roleDe(s) === "open" && s.is_final_positive))
          .map((s) => s.stage_key),
      ),
    [stages],
  );
  const openKeys = useMemo(
    () =>
      new Set(
        stages
          .filter(
            (s) =>
              !(roleDe(s) === "won" || (roleDe(s) === "open" && s.is_final_positive)) &&
              !(roleDe(s) === "lost" || (roleDe(s) === "open" && s.is_final_negative)),
          )
          .map((s) => s.stage_key),
      ),
    [stages],
  );

  const stats = useMemo(() => {
    const inProgressData = allItems.filter((item) => openKeys.has(item.status));
    const soldData = allItems.filter((item) => wonKeys.has(item.status));

    let sold = 0;
    let mrr = 0;
    let projeto = 0;
    for (const item of soldData) {
      const items = item.items?.filter((i: any) => i != null) ?? [];
      if (items.length > 0) {
        for (const it of items) {
          const val = Number(it.sale_value) || 0;
          sold += val;
          if (it.product?.type === "mrr") mrr += val;
          else if (it.product?.type === "projeto") projeto += val;
        }
      } else {
        const val = Number(item.sale_value) || 0;
        sold += val;
        if (item.product_type === "mrr") mrr += val;
        else if (item.product_type === "projeto") projeto += val;
      }
    }

    const inProgress = inProgressData.reduce((sum, item) => sum + (Number(item.sale_value) || 0), 0);

    // Totais server-side (não limitados às páginas carregadas).
    const totalNoPipe = Object.values(stageData).reduce((sum, s) => sum + (s?.totalCount ?? 0), 0);
    const soldCount = [...wonKeys].reduce(
      (sum, key) => sum + (stageData[key]?.totalCount ?? 0),
      0,
    ) || soldData.length;
    const inProgressCount = [...openKeys].reduce((sum, key) => sum + (stageData[key]?.totalCount ?? 0), 0);
    const conversionRate = totalNoPipe > 0 ? (soldCount / totalNoPipe) * 100 : 0;

    return { sold, soldCount, mrr, projeto, inProgress, inProgressCount, conversionRate };
  }, [allItems, stageData, wonKeys, openKeys]);

  const displayStats = useMemo(() => {
    if (!metrics.propostas) return stats;
    return {
      ...metrics.propostas,
      inProgress: stats.inProgress,
      inProgressCount: stats.inProgressCount,
    };
  }, [metrics.propostas, stats]);

  const { data: drilldownData = [], isLoading: drilldownLoading } = useMetricDrilldown(
    drilldownMetric ?? "vendas_total",
    periodRange,
  );

  const drilldownPeriodLabel = useMemo(
    () => (periodRange ? formatPeriodLabel(periodRange) : "Geral"),
    [periodRange],
  );

  const drilldownDisplayValue = useMemo(() => {
    if (!drilldownMetric) return "";
    switch (drilldownMetric) {
      case "pipeline_ativo": return formatCurrency(displayStats.inProgress);
      case "vendas_total": return formatCurrency(displayStats.sold);
      case "rec_vendida": return formatCurrency(displayStats.mrr);
      case "projetos_vendidos": return formatCurrency(displayStats.projeto);
      case "taxa_conversao": return `${displayStats.conversionRate.toFixed(1)}%`;
    }
  }, [drilldownMetric, displayStats]);

  const drilldownDisplayCount = useMemo(() => {
    if (!drilldownMetric) return 0;
    switch (drilldownMetric) {
      case "pipeline_ativo": return displayStats.inProgressCount;
      case "vendas_total": return displayStats.soldCount;
      case "taxa_conversao": return displayStats.soldCount + displayStats.inProgressCount;
      default: return drilldownData.length;
    }
  }, [drilldownMetric, displayStats, drilldownData]);

  const funnelData = useMemo(() => {
    return stages.slice(0, 4).map((stage) => {
      const items = allItems.filter((item) => item.status === stage.stage_key);
      return {
        id: stage.stage_key,
        name: stage.name,
        count: items.length,
        value: items.reduce((sum: number, item: any) => sum + (Number(item.sale_value) || 0), 0),
      };
    });
  }, [allItems, stages]);

  const productData = useMemo(() => {
    const productMap = new Map<string, {
      productId: string;
      productName: string;
      productType: "mrr" | "projeto" | "unitario";
      proposalCount: number;
      proposalValue: number;
      soldCount: number;
      soldValue: number;
    }>();

    allItems.forEach((proposta) => {
      const items = proposta.items || [];
      const isSold = wonKeys.has(proposta.status);
      items.forEach((item: any) => {
        if (!item.product) return;
        const existing = productMap.get(item.product.id);
        if (existing) {
          existing.proposalCount += 1;
          existing.proposalValue += item.sale_value || 0;
          if (isSold) {
            existing.soldCount += 1;
            existing.soldValue += item.sale_value || 0;
          }
        } else {
          productMap.set(item.product.id, {
            productId: item.product.id,
            productName: item.product.name,
            productType: item.product.type as "mrr" | "projeto" | "unitario",
            proposalCount: 1,
            proposalValue: item.sale_value || 0,
            soldCount: isSold ? 1 : 0,
            soldValue: isSold ? item.sale_value || 0 : 0,
          });
        }
      });
    });

    return Array.from(productMap.values());
  }, [allItems, wonKeys]);

  const soldSorted = useMemo(
    () =>
      allItems
        .filter((p) => wonKeys.has(p.status))
        .sort((a, b) => new Date(b.closed_at || 0).getTime() - new Date(a.closed_at || 0).getTime())
        .slice(0, 5),
    [allItems, wonKeys],
  );

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <KpiRow cols={5}>
        <AnalyticsStatCard
          icon={Briefcase}
          label="Pipeline Ativo"
          value={formatCurrency(displayStats.inProgress)}
          sub={`${displayStats.inProgressCount} propostas`}
          accent="gold"
          onClick={() => setDrilldownMetric("pipeline_ativo")}
        />
        <AnalyticsStatCard
          icon={CircleDollarSign}
          label="Vendas Total"
          value={formatCurrency(displayStats.sold)}
          sub={`${displayStats.soldCount} vendas`}
          accent="success"
          tintValue
          delay={0.05}
          onClick={() => setDrilldownMetric("vendas_total")}
        />
        <AnalyticsStatCard
          icon={Repeat}
          label="Rec. Vendida"
          value={formatCurrency(displayStats.mrr)}
          sub="valor vendido /mês"
          accent="blue"
          delay={0.1}
          onClick={() => setDrilldownMetric("rec_vendida")}
        />
        <AnalyticsStatCard
          icon={Package}
          label="Projetos Vendidos"
          value={formatCurrency(displayStats.projeto)}
          sub="valor vendido"
          accent="neutral"
          delay={0.15}
          onClick={() => setDrilldownMetric("projetos_vendidos")}
        />
        <AnalyticsStatCard
          label="Taxa de Conversão"
          icon={Percent}
          value={`${displayStats.conversionRate.toFixed(1)}%`}
          sub="vendas / total no pipe"
          accent="gold"
          tintValue
          delay={0.2}
          onClick={() => setDrilldownMetric("taxa_conversao")}
        />
      </KpiRow>

      {/* As abas "funil / Produtos" viraram seções (mockup V5): o que estava
          escondido atrás do segmentado fica à vista, na ordem de leitura. */}
      <div className="grid gap-4 md:grid-cols-2">
            <AnalyticsPanel title={pipeline.name} subtitle="Volume e valor por etapa">
              <ContinuousFunnel
                unit="propostas"
                stages={funnelData.map((stage) => ({
                  key: stage.id,
                  label: stage.name,
                  count: stage.count,
                  valueLabel: formatCurrency(stage.value),
                  tone: wonKeys.has(stage.id) ? ("success" as const) : undefined,
                }))}
              />
            </AnalyticsPanel>

            <AnalyticsPanel
              title="Performance por Responsável"
              subtitle="Propostas trabalhadas e valor fechado"
            >
              <MemberLeaderboard
                rows={responsibleMembers
                  .map((member) => {
                    const memberProposals = allItems.filter((p) => p.responsible_id === member.id);
                    const memberSold = memberProposals.filter((p) => wonKeys.has(p.status));
                    const memberSoldValue = memberSold.reduce(
                      (sum: number, p: any) => sum + (Number(p.sale_value) || 0),
                      0,
                    );
                    const rate =
                      memberProposals.length > 0 ? (memberSold.length / memberProposals.length) * 100 : 0;
                    return {
                      id: member.id,
                      name: member.name,
                      ratePct: rate,
                      headline: formatCurrency(memberSoldValue),
                      subline: `${rate.toFixed(0)}% de fechamento`,
                      context: `${memberProposals.length} propostas · ${memberSold.length} venda${memberSold.length !== 1 ? "s" : ""}`,
                      currency: true,
                      total: memberProposals.length,
                    };
                  })
                  .sort((a, b) => b.total - a.total)}
              />
            </AnalyticsPanel>

            <section className="min-w-0 rounded-card border border-card-border bg-card p-5 text-card-foreground shadow-relevo sm:p-6">
              <h3 className="mb-5 flex items-center gap-2 text-base font-bold leading-tight tracking-tight">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-success/10 text-success">
                  <TrendingUp className="h-4 w-4" aria-hidden />
                </span>
                Vendas recentes
              </h3>
              <div className="space-y-2.5">
                {soldSorted.map((sale) => (
                  <motion.div
                    key={sale.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-success/20 bg-success/5 p-3.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success/10">
                        <TrendingUp className="h-5 w-5 text-success" aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{sale.lead?.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {sale.lead?.company}
                          {sale.closer?.name ? ` • ${sale.closer.name}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-extrabold tabular-nums tracking-[-0.02em] text-success">{formatCurrency(Number(sale.sale_value) || 0)}</p>
                      <p className="text-xs text-muted-foreground">
                        {sale.closed_at && format(new Date(sale.closed_at), "dd/MM/yyyy", { locale: ptBR })}
                      </p>
                    </div>
                  </motion.div>
                ))}

                {soldSorted.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">Nenhuma venda fechada ainda</p>
                )}
              </div>
            </section>
        <LossReasonsPanel periodRange={periodRange} />
      </div>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
          <IconChip icon={Package} />
          Produtos
        </h3>
        <ProductAnalyticsChart data={productData} />
      </section>

      {/* A página velha passava props que o componente NÃO tem (open/onOpenChange
          — erro de tipo no baseline do tsc): o sheet nunca abria. Aqui a fiação
          usa o contrato real (isOpen/onClose/onSelectItem/metricType). */}
      <MetricDrilldownSheet
        isOpen={!!drilldownMetric}
        onClose={() => setDrilldownMetric(null)}
        onSelectItem={(leadId) => openLead(leadId)}
        metricType={drilldownMetric ?? "vendas_total"}
        periodLabel={drilldownPeriodLabel}
        displayValue={drilldownDisplayValue}
        displayCount={drilldownDisplayCount}
        data={drilldownData}
        isLoading={drilldownLoading}
      />
    </div>
  );
}
