import { memo, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useFunnelHealth,
  type FunnelHealthSeller,
  type FunnelHealthStages,
} from "@/modules/analytics/hooks/useFunnelHealth";
import {
  computeSaudePeriodRange,
  type SaudeCustomRange,
  type SaudePeriodPreset,
  type SaudeRange,
} from "@/modules/analytics/lib/saude-period";
import { format } from "date-fns";
import { LeadPanelProvider, LeadDetailSheet, useLeadSheet } from "@/modules/leads";
import { FunnelStageLeadsSheet } from "./FunnelStageLeadsSheet";
import { SaudeOriginFilter } from "./SaudeOriginFilter";
import { SaudePeriodFilter } from "./SaudePeriodFilter";
import { ORIGIN_LABELS } from "@/modules/analytics/hooks/useMktOriginConfig";

type HealthStatus = "ok" | "warn" | "bad";

type StageKey = keyof FunnelHealthStages;

interface StageDef {
  key: StageKey;
  label: string;
  tooltip: string;
  /** meta de conversão sobre a etapa anterior (%); null na primeira etapa */
  goal: number | null;
}

// Semântica travada no grill (CONTEXT.md: Funnel Health Indicator).
// Metas fixas do produto: 90/40/30/65/25.
const STAGE_DEFS: StageDef[] = [
  {
    key: "entraram",
    label: "Entraram",
    tooltip:
      "Todo lead criado no período, de qualquer origem: anúncio, formulário do site, WhatsApp, importação ou cadastro manual.",
    goal: null,
  },
  {
    key: "avaliados",
    label: "Avaliados",
    tooltip:
      'Leads que receberam uma classificação de qualidade — pela IA (pré-qualificação) ou pelo vendedor (qualificação final). Qualquer nota conta, até "desqualificado": significa que alguém olhou.',
    goal: 90,
  },
  {
    key: "bons",
    label: "Bons leads",
    tooltip:
      "Leads classificados como Prata, Ouro ou Diamante — os que valem o esforço comercial. Bronze e desqualificados ficam de fora. Se a IA e o vendedor classificaram diferente, vale a do vendedor.",
    goal: 40,
  },
  {
    key: "reuniao",
    label: "Reunião marcada",
    tooltip:
      'Leads que tiveram reunião agendada — pelo time (card movido para "Agendado"), pela IA ou pela agenda integrada. Conta o histórico: vale mesmo que o lead já tenha avançado de etapa.',
    goal: 30,
  },
  {
    key: "compareceram",
    label: "Compareceram",
    tooltip: 'Leads cuja reunião de fato aconteceu — card movido para "Compareceu".',
    goal: 65,
  },
  {
    key: "compraram",
    label: "Compraram",
    tooltip: "Leads que fecharam negócio — chegaram à etapa de venda no funil de Orçamentos.",
    goal: 25,
  },
];

const TRANSITION_TOOLTIPS: Record<string, string> = {
  "Entraram → Avaliados":
    "De cada 10 leads que entraram, quantos receberam avaliação de qualidade (da IA ou do vendedor).",
  "Avaliados → Bons":
    "De cada 10 leads avaliados, quantos foram classificados como Prata, Ouro ou Diamante.",
  "Bons → Reunião": "De cada 10 bons leads, quantos chegaram a ter uma reunião marcada.",
  "Reunião → Compareceu": "De cada 10 reuniões marcadas, quantas de fato aconteceram.",
  "Compareceu → Venda": "De cada 10 leads que compareceram à reunião, quantos fecharam negócio.",
};

const TRANSITION_LABELS = [
  "Entraram → Avaliados",
  "Avaliados → Bons",
  "Bons → Reunião",
  "Reunião → Compareceu",
  "Compareceu → Venda",
];

const MATRIX_TOOLTIPS: Record<string, string> = {
  Vinculados:
    "Leads criados no período cujo campo Pré-vendas aponta para esta pessoa. Todas as colunas desta linha falam só desses leads.",
  Avaliados: "Desses leads, quantos receberam classificação de qualidade.",
  Bons: "Desses leads, quantos foram classificados Prata, Ouro ou Diamante.",
  Reunião: "Desses leads, quantos tiveram reunião marcada.",
  Compareceram: "Desses leads, quantos tiveram reunião realizada.",
  Compraram:
    "Desses leads, quantos chegaram à etapa de venda em Orçamentos. O crédito é de quem fez a pré-venda — mesmo que outro vendedor tenha fechado. Negócio ainda aberto em Orçamentos não conta.",
};

interface TransitionRow {
  label: string;
  tooltip: string;
  conv: number | null;
  goal: number;
}

function statusOf(conv: number, goal: number): HealthStatus {
  if (conv >= goal) return "ok";
  if (conv >= goal * 0.7) return "warn";
  return "bad";
}

const STATUS_TEXT: Record<HealthStatus, string> = {
  ok: "text-emerald-500",
  warn: "text-primary",
  bad: "text-red-500",
};

const STATUS_LED: Record<HealthStatus, string> = {
  ok: "bg-emerald-500 shadow-[0_0_8px_hsl(152_76%_40%/.55)]",
  warn: "bg-primary shadow-[0_0_8px_hsl(47_100%_50%/.55)]",
  bad: "bg-red-500 shadow-[0_0_8px_hsl(0_72%_51%/.6)]",
};

const STATUS_CHIP: Record<HealthStatus, { label: string; cls: string }> = {
  ok: { label: "Saudável", cls: "bg-emerald-500/10 text-emerald-500" },
  warn: { label: "Atenção", cls: "bg-primary/10 text-primary" },
  bad: { label: "Gargalo", cls: "bg-red-500/15 text-red-500" },
};

function fmtPct(v: number) {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function fmtDays(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function HelpTip({
  text,
  children,
  align = "start",
}: {
  text: string;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help border-b border-dashed border-muted-foreground/50 pb-px">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent align={align} className="max-w-[300px] p-3.5 leading-relaxed">
        <span className="mb-1.5 block text-[9.5px] font-bold uppercase tracking-[0.16em] text-primary">
          O que conta aqui
        </span>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function StatusChip({ status }: { status: HealthStatus }) {
  const chip = STATUS_CHIP[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        chip.cls
      )}
    >
      <i className="h-1.5 w-1.5 rounded-full bg-current" />
      {chip.label}
    </span>
  );
}

function TabSaudeBase() {
  // Período local da aba — independente do período global do CommandHeader.
  const [preset, setPreset] = useState<SaudePeriodPreset>("month");
  const [customRange, setCustomRange] = useState<SaudeCustomRange | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);

  const computedRange = useMemo(
    () => computeSaudePeriodRange(preset, customRange),
    [preset, customRange],
  );
  // Personalizado incompleto (só `from`) → mantém o último range válido nos
  // dados, sem disparar query com intervalo aberto. Default (month) garante
  // range válido no primeiro render.
  const lastValidRangeRef = useRef<SaudeRange | null>(null);
  if (computedRange) lastValidRangeRef.current = computedRange;
  const range = computedRange ?? lastValidRangeRef.current!;

  const { data, isLoading } = useFunnelHealth({ start: range.start, end: range.end }, origins);
  const [openStage, setOpenStage] = useState<StageKey | null>(null);
  const { openLead } = useLeadSheet();

  const periodLabel = `de ${format(range.start, "dd/MM")} a ${format(range.end, "dd/MM")}`;
  const originsLabel = origins
    .map((o) => ORIGIN_LABELS[o as keyof typeof ORIGIN_LABELS] ?? o)
    .join(" + ");

  if (isLoading || !data) {
    return (
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[380px_1fr]">
        <Skeleton className="h-[420px]" />
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array(4)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
          </div>
          <Skeleton className="h-72" />
          <Skeleton className="h-56" />
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

  const cohort = data.cohort_total;
  const sold = data.stages.compraram;
  const booked = data.stages.reuniao;
  const held = data.stages.compareceram;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <SaudePeriodFilter
          preset={preset}
          customRange={customRange}
          onPresetChange={setPreset}
          onCustomRangeChange={setCustomRange}
        />
        <SaudeOriginFilter value={origins} onChange={setOrigins} />
      </div>
      <div className="mt-3 grid items-start gap-4 lg:grid-cols-[380px_1fr]">
        {/* ───── Rail: gargalo + ranking de transições ───── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card>
            <CardContent className="p-6">
              {bottleneck ? (
                <>
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-red-500">
                    Maior gargalo
                  </div>
                  <div className="mt-2 bg-gradient-to-b from-red-400 to-red-600 bg-clip-text text-7xl font-black tracking-tighter text-transparent tabular-nums">
                    {fmtPct(bottleneck.conv)}
                  </div>
                  <div className="mt-3 text-[15px] font-semibold">
                    {bottleneck.label}
                    <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                      meta {bottleneck.goal}%
                    </span>
                  </div>
                  {bottleneck.label === "Reunião → Compareceu" && (
                    <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                      Só <b className="font-semibold text-foreground">{held} das {booked} reuniões</b>{" "}
                      marcadas aconteceram —{" "}
                      <b className="font-semibold text-foreground">{booked - held} perdidas</b> no
                      período.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    Saúde do funil
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sem leads no período selecionado — as taxas aparecem quando a coorte tiver
                    volume.
                  </p>
                </>
              )}

              <div className="mt-5 overflow-hidden rounded-xl bg-background/60">
                {transitions.map((t, i) => {
                  const status = t.conv !== null ? statusOf(t.conv, t.goal) : null;
                  return (
                    <div
                      key={t.label}
                      className={cn(
                        "flex items-center gap-2.5 px-3.5 py-3 text-xs",
                        i > 0 && "border-t border-border/50"
                      )}
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          status ? STATUS_LED[status] : "bg-muted-foreground/30"
                        )}
                      />
                      <span className="flex-1 font-medium">
                        <HelpTip text={t.tooltip}>{t.label}</HelpTip>
                      </span>
                      <span
                        className={cn(
                          "text-[13px] font-bold tabular-nums",
                          status ? STATUS_TEXT[status] : "text-muted-foreground"
                        )}
                      >
                        {t.conv !== null ? fmtPct(t.conv) : "—"}
                      </span>
                      <span className="w-14 text-right text-[10px] text-muted-foreground tabular-nums">
                        meta {t.goal}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* ───── Tempo até a venda (ciclos médios, variante V3) ───── */}
              {data.cycles && (
                <div className="mt-5 border-t border-border pt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      <HelpTip text="Médias calculadas só sobre os leads do período que viraram venda. A venda vale a primeira chegada à etapa de venda em Orçamentos; a reunião, a primeira reunião realizada.">
                        Tempo até a venda
                      </HelpTip>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {data.cycles.sales_count > 0
                        ? `média · ${data.cycles.sales_count} ${data.cycles.sales_count === 1 ? "venda" : "vendas"}`
                        : "sem vendas no recorte"}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground ring-[1.5px] ring-border" />
                    <div className="relative h-3.5 min-w-0 flex-1">
                      <i className="absolute inset-x-0.5 top-1.5 block h-0.5 rounded-full bg-gradient-to-r from-muted-foreground/50 to-primary" />
                      <b className="absolute left-1/2 top-[-7px] -translate-x-1/2 whitespace-nowrap bg-card px-1.5 text-[13.5px] font-extrabold tabular-nums">
                        {fmtDays(data.cycles.lead_to_meeting_days)}
                        <span className="text-[10.5px] font-bold text-muted-foreground">
                          {data.cycles.lead_to_meeting_days != null && "d"}
                        </span>
                      </b>
                    </div>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary ring-[1.5px] ring-primary/50 shadow-[0_0_10px_hsl(47_100%_50%/.35)]" />
                    <div className="relative h-3.5 min-w-0 flex-1">
                      <i className="absolute inset-x-0.5 top-1.5 block h-0.5 rounded-full bg-gradient-to-r from-primary to-emerald-500" />
                      <b className="absolute left-1/2 top-[-7px] -translate-x-1/2 whitespace-nowrap bg-card px-1.5 text-[13.5px] font-extrabold tabular-nums">
                        {fmtDays(data.cycles.meeting_to_sale_days)}
                        <span className="text-[10.5px] font-bold text-muted-foreground">
                          {data.cycles.meeting_to_sale_days != null && "d"}
                        </span>
                      </b>
                    </div>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-[1.5px] ring-emerald-500/50 shadow-[0_0_10px_hsl(152_76%_40%/.35)]" />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                    <span>lead entrou</span>
                    <span>compareceu</span>
                    <span>venda</span>
                  </div>

                  <div className="mt-4 flex items-center gap-3 rounded-xl bg-background/60 px-4 py-3">
                    <span className="whitespace-nowrap text-3xl font-black tracking-tight text-primary tabular-nums">
                      {fmtDays(data.cycles.lead_to_sale_days)}
                      <span className="text-[15px] font-bold text-muted-foreground">
                        {data.cycles.lead_to_sale_days != null && "d"}
                      </span>
                    </span>
                    <span className="text-[11.5px] leading-snug text-muted-foreground">
                      <b className="font-semibold text-foreground">Ciclo médio de venda</b>
                      <br />
                      da entrada do lead até fechar em Orçamentos
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ───── Main: KPIs + mesa + matriz ───── */}
        <div className="flex flex-col gap-4">
          <motion.div
            className="grid grid-cols-2 gap-3 xl:grid-cols-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardContent className="p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Leads no período
                </div>
                <div className="mt-1.5 text-[26px] font-extrabold tracking-tight tabular-nums">
                  {cohort}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {origins.length > 0 ? originsLabel : `criados ${periodLabel}`}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Viraram venda
                </div>
                <div className="mt-1.5 text-[26px] font-extrabold tracking-tight text-primary tabular-nums">
                  {sold}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {cohort > 0 ? `${fmtPct((sold / cohort) * 100)} ponta a ponta` : "—"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Etapas saudáveis
                </div>
                <div className="mt-1.5 text-[26px] font-extrabold tracking-tight tabular-nums">
                  <span className="text-emerald-500">{healthy}</span>
                  <span className="text-base text-muted-foreground"> / {transitions.length}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">vs metas Torque</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Reuniões perdidas
                </div>
                <div className="mt-1.5 text-[26px] font-extrabold tracking-tight text-red-500 tabular-nums">
                  {booked - held}
                </div>
                <div className="text-[11px] text-muted-foreground">não aconteceram</div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <Card>
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
                        className={cn("cursor-pointer", status === "bad" && "bg-red-500/5")}
                      >
                        <TableCell className="pl-5 font-semibold">
                          <HelpTip text={s.tooltip}>{s.label}</HelpTip>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-bold tabular-nums",
                            isLast && "text-primary"
                          )}
                        >
                          {count}
                        </TableCell>
                        <TableCell className="pl-4">
                          <div className="relative h-[18px] min-w-[160px] overflow-hidden rounded-[5px] bg-muted/60">
                            <div
                              className={cn(
                                "absolute inset-y-0 left-0 min-w-[3px] rounded-[5px] bg-gradient-to-r",
                                status === "bad" ? "from-red-700 to-red-500" : "from-yellow-600 to-primary"
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
                              <b className={cn(status === "bad" && "text-red-500")}>{fmtPct(conv)}</b>{" "}
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
            <div className="mb-3">
              <div className="text-sm font-semibold">Pré-vendas × etapas</div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                Leads do período agrupados por quem fez a pré-venda — a venda credita o pré-vendas, não quem fechou.
              </div>
            </div>
            <Card>
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
                              <span className="mr-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-muted align-middle text-[9px] font-bold text-primary">
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
                              !ghost && "text-primary"
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
          openLead(id);
        }}
      />
    </TooltipProvider>
  );
}

function TabSaudeWithProviders() {
  return (
    <LeadPanelProvider>
      <TabSaudeBase />
      <LeadDetailSheet />
    </LeadPanelProvider>
  );
}

export const TabSaude = memo(TabSaudeWithProviders);
