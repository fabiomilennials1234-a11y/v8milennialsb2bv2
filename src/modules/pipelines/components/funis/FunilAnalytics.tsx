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
 * documentado no relatório da fatia. As agregações client-side (calor, vendas
 * recentes, produtos) leem os itens CARREGADOS — mesmo recorte que as páginas
 * velhas paginadas liam.
 */
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Package } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CustomPipelineStage, StageRole } from "@/contracts/pipe";
import type { DateRange } from "@/lib/metrics-period";
import type { Pipeline } from "@/modules/pipelines/hooks/model/usePipelines";
import type { StageData } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import type { FunilMetrics } from "@/modules/pipelines/hooks/config/useFunilMetrics";
import {
  AnalyticsPanel,
  AnalyticsStatCard,
  ContinuousFunnel,
  CalorBars,
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
        stages={stages}
        stageData={stageData}
        allItems={allItems}
        metrics={metrics}
        periodRange={periodRange}
        responsibleMembers={responsibleMembers}
      />
    );
  }
  return <GenericBlock metrics={metrics} />;
}

// ── Genérico: o cabeçalho que funil custom nunca teve (SCRUM-633) ───────────

function GenericBlock({ metrics }: { metrics: FunilMetrics }) {
  const g = metrics.generic;
  if (!g) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <AnalyticsStatCard label="Negócios" value={String(g.total)} sub="no recorte" accent="gold" />
      <AnalyticsStatCard label="Em aberto" value={String(g.openCount)} sub="etapas abertas" accent="neutral" delay={0.05} />
      <AnalyticsStatCard label="Ganhos" value={String(g.wonCount)} sub="etapas won" accent="success" tintValue delay={0.1} />
      <AnalyticsStatCard label="Perdidos" value={String(g.lostCount)} sub="etapas lost" accent="neutral" delay={0.15} />
      <AnalyticsStatCard
        label="Conversão"
        value={`${g.conversionRate.toFixed(1)}%`}
        sub="ganhos / total"
        accent="gold"
        tintValue
        delay={0.2}
      />
    </div>
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
  stages,
  stageData,
  allItems,
  metrics,
  periodRange,
  responsibleMembers,
}: Omit<FunilAnalyticsProps, "pipeline">) {
  const [analyticsTab, setAnalyticsTab] = useState<"propostas" | "produtos">("propostas");
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

  const calorData = useMemo(() => {
    const activeProposals = allItems.filter((item) => openKeys.has(item.status));
    const grouped: { [key: number]: { calor: number; value: number; count: number } } = {};
    activeProposals.forEach((item) => {
      const calor = item.calor ?? 5;
      if (!grouped[calor]) grouped[calor] = { calor, value: 0, count: 0 };
      grouped[calor].value += Number(item.sale_value) || 0;
      grouped[calor].count += 1;
    });
    return Object.values(grouped);
  }, [allItems, openKeys]);

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
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <AnalyticsStatCard
          label="Pipeline Ativo"
          value={formatCurrency(displayStats.inProgress)}
          sub={`${displayStats.inProgressCount} propostas`}
          accent="gold"
          onClick={() => setDrilldownMetric("pipeline_ativo")}
        />
        <AnalyticsStatCard
          label="Vendas Total"
          value={formatCurrency(displayStats.sold)}
          sub={`${displayStats.soldCount} vendas`}
          accent="success"
          tintValue
          delay={0.05}
          onClick={() => setDrilldownMetric("vendas_total")}
        />
        <AnalyticsStatCard
          label="Rec. Vendida"
          value={formatCurrency(displayStats.mrr)}
          sub="valor vendido /mês"
          accent="blue"
          delay={0.1}
          onClick={() => setDrilldownMetric("rec_vendida")}
        />
        <AnalyticsStatCard
          label="Projetos Vendidos"
          value={formatCurrency(displayStats.projeto)}
          sub="valor vendido"
          accent="neutral"
          delay={0.15}
          onClick={() => setDrilldownMetric("projetos_vendidos")}
        />
        <AnalyticsStatCard
          label="Taxa de Conversão"
          value={`${displayStats.conversionRate.toFixed(1)}%`}
          sub="vendas / total no pipe"
          accent="gold"
          tintValue
          delay={0.2}
          onClick={() => setDrilldownMetric("taxa_conversao")}
        />
      </div>

      <Tabs value={analyticsTab} onValueChange={(v) => setAnalyticsTab(v as "propostas" | "produtos")}>
        <TabsList className="bg-muted/50">
          <TabsTrigger value="propostas" className="gap-1.5">
            <TrendingUp className="w-4 h-4" />
            Propostas
          </TabsTrigger>
          <TabsTrigger value="produtos" className="gap-1.5">
            <Package className="w-4 h-4" />
            Produtos
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AnimatePresence mode="wait">
        {analyticsTab === "propostas" ? (
          <motion.div
            key="propostas-analytics"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid md:grid-cols-2 gap-6"
          >
            <AnalyticsPanel title="Funil de Vendas" subtitle="Volume e valor por etapa">
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
              title="Propostas por Calor"
              subtitle="Valor em aberto por temperatura"
              dot="destructive"
            >
              <CalorBars data={calorData} />
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

            <div className="glass-card p-6">
              <h3 className="font-semibold mb-6 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-success" />
                Vendas Recentes
              </h3>
              <div className="space-y-3">
                {soldSorted.map((sale) => (
                  <motion.div
                    key={sale.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-4 rounded-lg border bg-success/5 border-success/20"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-success" />
                      </div>
                      <div>
                        <p className="font-medium">{sale.lead?.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {sale.lead?.company}
                          {sale.closer?.name ? ` • ${sale.closer.name}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-success">{formatCurrency(Number(sale.sale_value) || 0)}</p>
                      <p className="text-xs text-muted-foreground">
                        {sale.closed_at && format(new Date(sale.closed_at), "dd/MM/yyyy", { locale: ptBR })}
                      </p>
                    </div>
                  </motion.div>
                ))}

                {soldSorted.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">Nenhuma venda fechada ainda</p>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="produtos-analytics"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <ProductAnalyticsChart data={productData} />
          </motion.div>
        )}
      </AnimatePresence>

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
