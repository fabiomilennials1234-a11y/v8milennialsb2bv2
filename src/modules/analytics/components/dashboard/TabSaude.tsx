import { memo } from "react";
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

interface TabSaudeProps {
  month: number;
  year: number;
}

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
  Vinculados: "Leads do período atribuídos a este pré-vendas.",
  Avaliados: "Quantos dos vinculados receberam classificação de qualidade.",
  Bons: "Quantos foram classificados Prata, Ouro ou Diamante.",
  Reunião: "Quantos tiveram reunião marcada.",
  Compareceram: "Quantos tiveram reunião realizada.",
  Compraram: "Quantos fecharam negócio em Orçamentos.",
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

function TabSaudeBase({ month, year }: TabSaudeProps) {
  const { data, isLoading } = useFunnelHealth(month, year);

  const monthLabel = new Date(year, month - 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  if (isLoading || !data) {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[380px_1fr]">
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
      <div className="grid items-start gap-4 lg:grid-cols-[380px_1fr]">
        {/* ───── Rail: gargalo + ranking de transições ───── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className="lg:sticky lg:top-5">
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
                <div className="text-[11px] text-muted-foreground">criados em {monthLabel}</div>
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
                      <TableRow key={s.key} className={cn(status === "bad" && "bg-red-500/5")}>
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
            <div className="mb-3 text-sm font-semibold">Pré-vendas × etapas</div>
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
    </TooltipProvider>
  );
}

export const TabSaude = memo(TabSaudeBase);
