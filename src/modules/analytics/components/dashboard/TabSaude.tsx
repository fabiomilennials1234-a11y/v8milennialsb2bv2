import { useNavigate } from "react-router-dom";
import { memo, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FocusCard, FocusTile, InkRow, InkSplit, KpiRow, KpiTile, ValueUnit } from "@/components/ui/bento";
import { Badge } from "@/components/ui/badge";
import { BadgeCheck, CalendarX, HeartPulse, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useFunnelHealth,
  type FunnelHealthSeller,
} from "@/modules/analytics/hooks/useFunnelHealth";
import type { PeriodRange } from "@/modules/analytics/hooks/useCommandMetrics";
import {
  STAGE_DEFS,
  TRANSITION_TOOLTIPS,
  TRANSITION_LABELS,
  statusOf,
  STATUS_LED,
  STATUS_CHIP,
  fmtPct,
  HelpTip,
  StatusChip,
  type StageKey,
} from "@/modules/analytics/lib/funnel-health-stages";
import { format } from "date-fns";
import { FunnelStageLeadsSheet } from "./FunnelStageLeadsSheet";
import { SaudeOriginFilter } from "./SaudeOriginFilter";
import { ORIGIN_LABELS } from "@/modules/analytics/hooks/useMktOriginConfig";

const MATRIX_TOOLTIPS: Record<string, string> = {
  Vinculados:
    "Leads criados no período cujo campo Pré-vendas aponta para esta pessoa. Todas as colunas desta linha falam só desses leads.",
  Avaliados: "Desses leads, quantos receberam classificação de qualidade.",
  Bons: "Desses leads, quantos foram classificados Prata, Ouro ou Diamante.",
  Reunião: "Desses leads, quantos tiveram reunião marcada.",
  Compareceram: "Desses leads, quantos tiveram reunião realizada.",
  Compraram:
    "Desses leads, quantos chegaram à etapa de venda no funil de fechamento. O crédito é de quem fez a pré-venda — mesmo que outro vendedor tenha fechado. Negócio ainda aberto não conta.",
};

interface TransitionRow {
  label: string;
  tooltip: string;
  conv: number | null;
  goal: number;
}

function fmtDays(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function TabSaudeBase({ range }: { range: PeriodRange }) {
  const navigate = useNavigate();
  // Data vem do período GLOBAL do CommandHeader (via prop `range`) — um único
  // filtro de data pra todo o Comando. Origem é filtro local, ortogonal.
  const [origins, setOrigins] = useState<string[]>([]);

  const { data, isLoading, isError, error, refetch } = useFunnelHealth(
    { start: range.start, end: range.end },
    origins,
  );
  const [openStage, setOpenStage] = useState<StageKey | null>(null);
  const [transicao, setTransicao] = useState<string | null>(null);
  
  const periodLabel = `de ${format(range.start, "dd/MM")} a ${format(range.end, "dd/MM")}`;
  const originsLabel = origins
    .map((o) => ORIGIN_LABELS[o as keyof typeof ORIGIN_LABELS] ?? o)
    .join(" + ");

  // Query falhou e não há dado em cache → mostra o erro. Antes caía no skeleton
  // abaixo e a aba ficava carregando pra sempre: foi assim que um overload
  // fantasma de get_funnel_health (erro 42725) virou tela morta e silenciosa.
  if (isError && !data) {
    return (
      <div className="rounded-card border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive">
        <p className="font-semibold">Erro ao carregar a saúde do funil</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {error instanceof Error ? error.message : "Verifique a conexão e tente de novo."}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[380px_1fr]">
        <Skeleton className="h-[420px] rounded-card" />
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {Array(4)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-card" />
              ))}
          </div>
          <Skeleton className="h-72 rounded-card" />
          <Skeleton className="h-56 rounded-card" />
        </div>
      </div>
    );
  }

  const counts = STAGE_DEFS.map((d) => data.stages[d.key]);

  const transitions: TransitionRow[] = STAGE_DEFS.slice(1).map((d, i) => {
    const prev = counts[i];
    const curr = counts[i + 1];
    return {
      label: TRANSITION_LABELS[i],
      tooltip: TRANSITION_TOOLTIPS[TRANSITION_LABELS[i]],
      conv: prev > 0 ? (curr / prev) * 100 : null,
      goal: d.goal as number,
    };
  });

  const measured = transitions.filter((t) => t.conv !== null) as Array<
    TransitionRow & { conv: number }
  >;
  const bottleneck = measured.length
    ? measured.reduce((worst, t) => (t.conv / t.goal < worst.conv / worst.goal ? t : worst))
    : null;
  const healthy = measured.filter((t) => statusOf(t.conv, t.goal) === "ok").length;
  // Transição em foco no herói: a escolhida, senão o maior gargalo.
  const foco = transitions.find((t) => t.label === transicao) ?? bottleneck ?? transitions[0] ?? null;

  const cohort = data.cohort_total;
  const sold = data.stages.compraram;
  const booked = data.stages.reuniao;
  const held = data.stages.compareceram;

  // V5: no Estúdio esta janela não tem moldura (`semMoldura` no registry) —
  // os blocos abaixo SÃO os cartões de bento, pousados direto na bancada.
  return (
    <TooltipProvider delayDuration={150}>
      {/* Falhou mas há dado anterior em cache (keepPreviousData): mantém a tela
          e avisa que os números podem estar defasados. */}
      {isError && (
        <div className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
          Não foi possível atualizar os dados — mostrando o último resultado carregado.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <SaudeOriginFilter value={origins} onChange={setOrigins} />
      </div>
      {/* V5: resumo (KPIs) → herói em tinta com as transições e o gargalo em
          ouro → tabelas. Os números são os mesmos; só a hierarquia mudou. */}
      <div className="mt-3 flex min-w-0 flex-col gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <KpiRow cols={4}>
            <KpiTile
              label="Leads no período"
              value={cohort}
              icon={Users}
              tone="neutral"
              note={origins.length > 0 ? originsLabel : `criados ${periodLabel}`}
            />
            <KpiTile
              label="Viraram venda"
              value={sold}
              icon={BadgeCheck}
              tone="gold"
              note={cohort > 0 ? `${fmtPct((sold / cohort) * 100)} ponta a ponta` : "—"}
            />
            <KpiTile
              label="Etapas saudáveis"
              value={<><span className="text-success">{healthy}</span><ValueUnit>/ {transitions.length}</ValueUnit></>}
              icon={HeartPulse}
              tone="good"
              note="vs metas Torque"
            />
            <KpiTile
              label="Reuniões perdidas"
              value={<span className={booked - held > 0 ? "text-destructive" : undefined}>{booked - held}</span>}
              icon={CalendarX}
              tone="bad"
              note="não aconteceram"
            />
            </KpiRow>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <InkSplit
              title={bottleneck ? "Maior gargalo" : "Saúde do funil"}
              count={bottleneck ? bottleneck.label : undefined}
              actions={<span className="text-[11.5px] text-tinta-muted">Clique numa transição</span>}
              list={transitions.map((t) => {
                const status = t.conv !== null ? statusOf(t.conv, t.goal) : null;
                const selected = t.label === foco?.label;
                return (
                  <InkRow key={t.label} selected={selected} onClick={() => setTransicao(t.label)} title={t.tooltip}>
                    <span
                      className={cn("h-2 w-2 shrink-0 rounded-full", status ? STATUS_LED[status] : "bg-white/30")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{t.label}</span>
                    <span className="shrink-0 text-[14px] font-extrabold tabular-nums">
                      {t.conv !== null ? fmtPct(t.conv) : "—"}
                    </span>
                    <span className={cn("w-16 shrink-0 text-right text-[11px] tabular-nums", selected ? "text-primary-foreground/70" : "text-tinta-muted")}>
                      meta {t.goal}%
                    </span>
                  </InkRow>
                );
              })}
              detail={
                foco ? (
                  <FocusCard className="gap-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="ink">{foco.label === bottleneck?.label ? "Maior gargalo" : "Transição"}</Badge>
                      {foco.conv !== null && (
                        <span className="ml-auto rounded-full bg-primary-foreground/10 px-2.5 py-0.5 text-[11px] font-bold">
                          {STATUS_CHIP[statusOf(foco.conv, foco.goal)].label}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="text-[clamp(3rem,6vw,4.5rem)] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
                        {foco.conv !== null ? fmtPct(foco.conv) : "—"}
                      </p>
                      <p className="mt-2 text-[1.2rem] font-extrabold tracking-[-0.03em]">
                        {foco.label}
                        <span className="ml-2 text-[13px] font-semibold text-primary-foreground/70">meta {foco.goal}%</span>
                      </p>
                    </div>
                    <p className="rounded-2xl bg-[hsl(40_60%_8%/.1)] px-3 py-2.5 text-[12.5px] font-semibold leading-relaxed">
                      {foco.label === "Reunião → Compareceu"
                        ? `Só ${held} das ${booked} reuniões marcadas aconteceram — ${booked - held} perdidas no período.`
                        : foco.tooltip}
                    </p>
                    {data.cycles && (
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
                        <FocusTile>
                          <p className="text-[1rem] font-extrabold tabular-nums">{fmtDays(data.cycles.lead_to_meeting_days)}{data.cycles.lead_to_meeting_days != null && " d"}</p>
                          <p className="text-[11px] font-semibold text-primary-foreground/70">lead → compareceu</p>
                        </FocusTile>
                        <FocusTile>
                          <p className="text-[1rem] font-extrabold tabular-nums">{fmtDays(data.cycles.meeting_to_sale_days)}{data.cycles.meeting_to_sale_days != null && " d"}</p>
                          <p className="text-[11px] font-semibold text-primary-foreground/70">compareceu → venda</p>
                        </FocusTile>
                        <FocusTile>
                          <p className="text-[1rem] font-extrabold tabular-nums">{fmtDays(data.cycles.lead_to_sale_days)}{data.cycles.lead_to_sale_days != null && " d"}</p>
                          <p className="text-[11px] font-semibold text-primary-foreground/70">
                            ciclo médio{data.cycles.sales_count > 0 ? ` · ${data.cycles.sales_count} ${data.cycles.sales_count === 1 ? "venda" : "vendas"}` : ""}
                          </p>
                        </FocusTile>
                      </div>
                    )}
                  </FocusCard>
                ) : (
                  <FocusCard>
                    <p className="text-[15px] font-bold">Sem leads no período</p>
                    <p className="text-[13px] text-primary-foreground/75">
                      As taxas aparecem quando a coorte tiver volume.
                    </p>
                  </FocusCard>
                )
              }
            />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Etapa</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="pl-4">Proporção</TableHead>
                    <TableHead className="text-right">Conversão</TableHead>
                    <TableHead className="pr-5 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {STAGE_DEFS.map((s, i) => {
                    const count = counts[i];
                    const conv = i === 0 ? null : transitions[i - 1].conv;
                    const status =
                      conv !== null && s.goal !== null ? statusOf(conv, s.goal) : null;
                    const isLast = s.key === "compraram";
                    return (
                      <TableRow
                        key={s.key}
                        onClick={() => setOpenStage(s.key)}
                        className={cn("cursor-pointer", status === "bad" && "bg-destructive/5")}
                      >
                        <TableCell className="pl-5 font-semibold">
                          <HelpTip text={s.tooltip}>{s.label}</HelpTip>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-bold tabular-nums",
                            isLast && "text-primary-soft-foreground"
                          )}
                        >
                          {count}
                        </TableCell>
                        <TableCell className="pl-4">
                          <div className="relative h-[18px] min-w-[160px] overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "absolute inset-y-0 left-0 min-w-[3px] rounded-full",
                                status === "bad" ? "bg-destructive" : "bg-primary"
                              )}
                              style={{ width: `${cohort > 0 ? (count / cohort) * 100 : 0}%` }}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {conv === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <>
                              <b className={cn(status === "bad" && "text-destructive")}>{fmtPct(conv)}</b>{" "}
                              <span className="text-[11px] text-muted-foreground">/ {s.goal}%</span>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          {status && <StatusChip status={status} />}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-[15px] tracking-[-0.02em]">Pré-vendas × etapas</CardTitle>
                <CardDescription className="text-xs">
                  Leads do período agrupados por quem fez a pré-venda — a venda credita o pré-vendas, não quem fechou.
                </CardDescription>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Pré-vendas</TableHead>
                    {Object.entries(MATRIX_TOOLTIPS).map(([label, tip]) => (
                      <TableHead key={label} className="text-right">
                        <HelpTip text={tip} align="end">
                          {label}
                        </HelpTip>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sellers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        Sem leads no período selecionado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.sellers.map((row: FunnelHealthSeller) => {
                      const ghost = row.team_member_id === null;
                      const initials = (row.name ?? "")
                        .split(/\s+/)
                        .map((p) => p[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase();
                      return (
                        <TableRow
                          key={row.team_member_id ?? "unassigned"}
                          className={cn(ghost && "italic text-muted-foreground")}
                        >
                          <TableCell className="pl-5 font-medium">
                            {!ghost && (
                              <span className="mr-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft align-middle text-[9px] font-bold text-primary-soft-foreground">
                                {initials}
                              </span>
                            )}
                            {ghost ? "Sem pré-vendas" : row.name ?? "—"}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {row.vinculados}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{row.avaliados}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.bons}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.reuniao}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.compareceram}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-semibold tabular-nums",
                              !ghost && "text-primary-soft-foreground"
                            )}
                          >
                            {row.compraram}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Card>
          </motion.div>
      </div>

      <FunnelStageLeadsSheet
        stage={openStage}
        label={openStage ? STAGE_DEFS.find((d) => d.key === openStage)!.label : ""}
        description={openStage ? STAGE_DEFS.find((d) => d.key === openStage)!.tooltip : ""}
        count={openStage ? data.stages[openStage] : 0}
        range={{ start: range.start, end: range.end }}
        origins={origins}
        periodLabel={periodLabel}
        onClose={() => setOpenStage(null)}
        onOpenLead={(id) => {
          setOpenStage(null);
          navigate(`/leads?lead=${id}`);
        }}
      />
    </TooltipProvider>
  );
}

function TabSaudeWithProviders({ range }: { range: PeriodRange }) {
  return (
      <TabSaudeBase range={range} />
  );
}

export const TabSaude = memo(TabSaudeWithProviders);
