import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAutoSaveField } from "@/shared/hooks/useAutoSaveField";
import {
  useOrgSalesSummary,
  type OrgSalesSummary,
} from "../../hooks/useOrgSalesSummary";
import {
  useOrgEconomicsInputs,
  useSaveOrgEconomicsInputs,
  type OrgEconomicsInputs,
} from "../../hooks/useOrgEconomicsInputs";
import {
  computeUnitEconomics,
  type UnitEconomicsInputs,
} from "../../lib/unit-economics";
import { computeEconomicsTimeline } from "../../lib/economics-timeline";
import {
  horizonteMeta,
  horizonteRange,
  formatPeriodRange,
  type Horizonte,
} from "./lib/format";
import type { InsightsMode } from "./InsightsModeTabs";
import type { AutosaveStatus } from "./AutosaveIndicator";
import {
  ExpenseInputsPanel,
  type ExpenseForm,
  type ExpenseRealRefs,
} from "./ExpenseInputsPanel";
import { MetricStatRow } from "./MetricStatRow";
import { CacBandGauge } from "./CacBandGauge";
import { PaybackCard } from "./PaybackCard";
import { UnitEconomicsJourneyChart } from "./UnitEconomicsJourneyChart";
import {
  InsightsSkeleton,
  InsightsErrorState,
  InsightsNoSalesState,
} from "./InsightsStates";

function seedForm(
  data: OrgEconomicsInputs | null,
  sales: OrgSalesSummary | undefined,
): ExpenseForm {
  return {
    anuncios: data?.anuncios ?? 0,
    custo_por_produto: data?.custo_por_produto ?? 0,
    despesas_mode: data?.despesas_mode ?? "detalhado",
    margem_contribuicao_pct: data?.margem_contribuicao_pct ?? 0,
    embalagem: data?.embalagem ?? 0,
    frete: data?.frete ?? 0,
    imposto_pct: data?.imposto_pct ?? 0,
    admin_pct: data?.admin_pct ?? 0,
    comissao_pct: data?.comissao_pct ?? 0,
    recompras: data?.recompras ?? 0,
    meta_num_vendas: data?.meta_num_vendas ?? sales?.num_vendas ?? 0,
    meta_ticket_medio: data?.meta_ticket_medio ?? sales?.ticket_medio ?? 0,
  };
}

interface InsightsContentProps {
  orgId: string;
  mode: InsightsMode;
  setMode: (m: InsightsMode) => void;
  horizonte: Horizonte;
}

/**
 * Camada de dados: dispara as queries (vendas reais + inputs dos 2 cenários),
 * trata loading/erro e entrega tudo resolvido p/ `InsightsLoaded`.
 */
export function InsightsContent({ orgId, mode, setMode, horizonte }: InsightsContentProps) {
  const { start, end } = useMemo(() => horizonteRange(horizonte), [horizonte]);

  const salesQuery = useOrgSalesSummary(orgId, start, end);
  const dadosQuery = useOrgEconomicsInputs(orgId, "dados");
  const projQuery = useOrgEconomicsInputs(orgId, "projecao");

  const loading = salesQuery.isLoading || dadosQuery.isLoading || projQuery.isLoading;
  const error = salesQuery.isError || dadosQuery.isError || projQuery.isError;

  if (loading) return <InsightsSkeleton />;

  if (error) {
    return (
      <InsightsErrorState
        onRetry={() => {
          salesQuery.refetch();
          dadosQuery.refetch();
          projQuery.refetch();
        }}
      />
    );
  }

  return (
    <InsightsLoaded
      key={`${orgId}:${horizonte}`}
      orgId={orgId}
      mode={mode}
      setMode={setMode}
      horizonte={horizonte}
      periodLabel={formatPeriodRange(start, end)}
      sales={salesQuery.data}
      dadosData={dadosQuery.data ?? null}
      projData={projQuery.data ?? null}
    />
  );
}

interface InsightsLoadedProps {
  orgId: string;
  mode: InsightsMode;
  setMode: (m: InsightsMode) => void;
  horizonte: Horizonte;
  periodLabel: string;
  sales: OrgSalesSummary | undefined;
  dadosData: OrgEconomicsInputs | null;
  projData: OrgEconomicsInputs | null;
}

function InsightsLoaded({
  orgId,
  mode,
  setMode,
  horizonte,
  periodLabel,
  sales,
  dadosData,
  projData,
}: InsightsLoadedProps) {
  const reduce = useReducedMotion();
  const saveMut = useSaveOrgEconomicsInputs();
  const curveMeses = horizonteMeta(horizonte).curveMeses;

  const [dadosForm, setDadosForm] = useState<ExpenseForm>(() => seedForm(dadosData, sales));
  const [projForm, setProjForm] = useState<ExpenseForm>(() => seedForm(projData, sales));
  const [dadosEdited, setDadosEdited] = useState(false);
  const [projEdited, setProjEdited] = useState(false);
  const [dadosPending, setDadosPending] = useState(false);
  const [projPending, setProjPending] = useState(false);

  // Autosave por cenário — debounce 600ms (DESIGN §6). Reusa useAutoSaveField
  // com value serializado p/ comparação por valor; pending dá feedback imediato.
  const dadosSave = useAutoSaveField({
    value: JSON.stringify(dadosForm),
    debounceMs: 600,
    save: async (json) => {
      const f = JSON.parse(json) as ExpenseForm;
      try {
        await saveMut.mutateAsync({
          organization_id: orgId,
          scenario: "dados",
          anuncios: f.anuncios,
          custo_por_produto: f.custo_por_produto,
          despesas_mode: f.despesas_mode,
          margem_contribuicao_pct: f.margem_contribuicao_pct,
          embalagem: f.embalagem,
          frete: f.frete,
          imposto_pct: f.imposto_pct,
          admin_pct: f.admin_pct,
          comissao_pct: f.comissao_pct,
          recompras: f.recompras,
        });
      } finally {
        setDadosPending(false);
      }
    },
  });

  const projSave = useAutoSaveField({
    value: JSON.stringify(projForm),
    debounceMs: 600,
    save: async (json) => {
      const f = JSON.parse(json) as ExpenseForm;
      try {
        await saveMut.mutateAsync({
          organization_id: orgId,
          scenario: "projecao",
          anuncios: f.anuncios,
          custo_por_produto: f.custo_por_produto,
          despesas_mode: f.despesas_mode,
          margem_contribuicao_pct: f.margem_contribuicao_pct,
          embalagem: f.embalagem,
          frete: f.frete,
          imposto_pct: f.imposto_pct,
          admin_pct: f.admin_pct,
          comissao_pct: f.comissao_pct,
          recompras: f.recompras,
          meta_num_vendas: Math.round(f.meta_num_vendas),
          meta_ticket_medio: f.meta_ticket_medio,
        });
      } finally {
        setProjPending(false);
      }
    },
  });

  const ticketReal = sales?.ticket_medio ?? 0;
  const numVendasReal = sales?.num_vendas ?? 0;

  // ── Economics por cenário ──────────────────────────────────────────────────
  // dadosForm/projForm têm ref estável entre edições → deps válidas p/ os memos.
  const dadosInputs = useMemo<UnitEconomicsInputs>(
    () => ({
      ticketMedio: ticketReal,
      numVendas: numVendasReal,
      anuncios: dadosForm.anuncios,
      custoProdutoUnit: dadosForm.custo_por_produto,
      despesasMode: dadosForm.despesas_mode,
      margemContribuicaoPct: dadosForm.margem_contribuicao_pct,
      embalagem: dadosForm.embalagem,
      frete: dadosForm.frete,
      impostoPct: dadosForm.imposto_pct,
      adminPct: dadosForm.admin_pct,
      comissaoPct: dadosForm.comissao_pct,
      recompras: dadosForm.recompras,
      horizonteMeses: curveMeses,
    }),
    [ticketReal, numVendasReal, dadosForm, curveMeses],
  );
  const projInputs = useMemo<UnitEconomicsInputs>(
    () => ({
      ticketMedio: projForm.meta_ticket_medio,
      numVendas: projForm.meta_num_vendas,
      anuncios: projForm.anuncios,
      custoProdutoUnit: projForm.custo_por_produto,
      despesasMode: projForm.despesas_mode,
      margemContribuicaoPct: projForm.margem_contribuicao_pct,
      embalagem: projForm.embalagem,
      frete: projForm.frete,
      impostoPct: projForm.imposto_pct,
      adminPct: projForm.admin_pct,
      comissaoPct: projForm.comissao_pct,
      recompras: projForm.recompras,
      horizonteMeses: curveMeses,
    }),
    [projForm, curveMeses],
  );

  const dadosEcon = useMemo(() => computeUnitEconomics(dadosInputs), [dadosInputs]);
  const projEcon = useMemo(() => computeUnitEconomics(projInputs), [projInputs]);

  const dadosTimeline = useMemo(
    () => computeEconomicsTimeline(dadosInputs),
    [dadosInputs],
  );
  const projTimeline = useMemo(
    () => computeEconomicsTimeline(projInputs),
    [projInputs],
  );

  const isProjection = mode === "projecao";
  const econ = isProjection ? projEcon : dadosEcon;
  const ticketMedio = isProjection ? projForm.meta_ticket_medio : ticketReal;
  const numVendas = isProjection ? projForm.meta_num_vendas : numVendasReal;
  const anuncios = isProjection ? projInputs.anuncios : dadosInputs.anuncios;

  const dadosStatus: AutosaveStatus =
    dadosPending || dadosSave.isSaving
      ? "saving"
      : dadosSave.lastError
        ? "error"
        : dadosEdited
          ? "saved"
          : "idle";
  const projStatus: AutosaveStatus =
    projPending || projSave.isSaving
      ? "saving"
      : projSave.lastError
        ? "error"
        : projEdited
          ? "saved"
          : "idle";

  const realRefs: ExpenseRealRefs = {
    anuncios: dadosForm.anuncios,
    custo_por_produto: dadosForm.custo_por_produto,
    // Ghost da MC = MC EFETIVA do cenário real (não o campo cru, que é 0 quando o
    // real está em modo 'detalhado'). Reflete a margem real p/ comparar na projeção.
    margem_contribuicao_pct: dadosEcon.cac.margemContribuicaoEfetivaPct ?? 0,
    embalagem: dadosForm.embalagem,
    frete: dadosForm.frete,
    imposto_pct: dadosForm.imposto_pct,
    admin_pct: dadosForm.admin_pct,
    comissao_pct: dadosForm.comissao_pct,
    recompras: dadosForm.recompras,
    num_vendas: numVendasReal,
    ticket_medio: ticketReal,
  };

  // Sem vendas reais na aba Dados → estado dedicado com CTA p/ projeção.
  if (!isProjection && numVendasReal <= 0) {
    return <InsightsNoSalesState onProjetar={() => setMode("projecao")} />;
  }

  const transition = reduce
    ? { duration: 0 }
    : { duration: 0.25, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={mode}
        role="tabpanel"
        id={`insights-panel-${mode}`}
        aria-labelledby={`insights-tab-${mode}`}
        initial={reduce ? false : { opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduce ? undefined : { opacity: 0, x: -12 }}
        transition={transition}
        className="space-y-6"
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Inputs (esquerda, sticky) */}
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-[140px]">
              {isProjection ? (
                <ExpenseInputsPanel
                  mode="projection"
                  value={projForm}
                  onChange={(next) => {
                    setProjForm(next);
                    setProjEdited(true);
                    setProjPending(true);
                  }}
                  status={projStatus}
                  onRetry={() => projSave.flush()}
                  realRefs={realRefs}
                  mcEfetivaPct={econ.cac.margemContribuicaoEfetivaPct}
                />
              ) : (
                <ExpenseInputsPanel
                  mode="real"
                  value={dadosForm}
                  onChange={(next) => {
                    setDadosForm(next);
                    setDadosEdited(true);
                    setDadosPending(true);
                  }}
                  status={dadosStatus}
                  onRetry={() => dadosSave.flush()}
                  mcEfetivaPct={econ.cac.margemContribuicaoEfetivaPct}
                />
              )}
            </div>
          </div>

          {/* Resultados (direita) */}
          <div className="space-y-6 lg:col-span-8">
            <MetricStatRow
              ticketMedio={ticketMedio}
              numVendas={numVendas}
              faturamento={econ.cac.faturamento}
              mode={mode}
              periodLabel={periodLabel}
            />

            <CacBandGauge
              cacAtual={econ.cac.cacAtual}
              cacMinimo={econ.bands.cacMinimo}
              cacIdeal={econ.bands.cacIdeal}
              cacMaximo={econ.bands.cacMaximo}
              anuncios={anuncios}
              numVendas={numVendas}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PaybackCard
                eyebrow="Payback 1 · primeira compra"
                payback={econ.paybacks.payback1}
                conceptFormula="P1 = CAC ÷ margem por venda"
                cac={econ.cac.cacAtual}
                denomLabel="margem por venda"
                denomValue={econ.paybacks.margemPorVenda}
                impossibleNote="Margem por venda não-positiva — cada venda não cobre o CAC."
              />
              <PaybackCard
                eyebrow="Payback 2 · com recompra"
                payback={econ.paybacks.payback2}
                conceptFormula="P2 = CAC ÷ margem com LTV"
                cac={econ.cac.cacAtual}
                denomLabel="margem com LTV"
                denomValue={econ.paybacks.margemComLtv}
                impossibleNote="LTV não cobre o CAC — sem payback com recompra."
              />
            </div>
          </div>

          {/* Jornada de unit economics (full-width) */}
          <div className="lg:col-span-12">
            <UnitEconomicsJourneyChart
              timeline={isProjection ? projTimeline : dadosTimeline}
              ghostCaixa={isProjection ? dadosTimeline.caixa : null}
              mode={mode}
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
