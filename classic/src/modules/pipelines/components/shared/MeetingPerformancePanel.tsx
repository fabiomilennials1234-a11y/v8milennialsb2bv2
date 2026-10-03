import { useMemo, useState } from "react";
import { startOfDay, endOfDay, startOfWeek, startOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnalyticsPanel } from "./analytics-ui";
import {
  useMeetingPerformanceBySeller,
  type MeetingPerfRange,
} from "@/modules/pipelines/hooks/config/useMeetingPerformanceBySeller";

type PeriodKey = "dia" | "semana" | "mes" | "periodo";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "dia", label: "Dia" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
  { key: "periodo", label: "Período" },
];

interface MeetingPerformancePanelProps {
  responsibleMembers: { id: string; name: string }[];
}

/**
 * "Performance por Responsável" — reuniões por pré-vendedor (Marcadas /
 * Compareceram / Não compareceram), contadas por data do evento, com filtro
 * próprio de período (Dia / Semana / Mês / Período personalizado).
 */
export function MeetingPerformancePanel({ responsibleMembers }: MeetingPerformancePanelProps) {
  const [period, setPeriod] = useState<PeriodKey>("mes");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const range = useMemo<MeetingPerfRange | null>(() => {
    const now = new Date();
    switch (period) {
      case "dia":
        return { start: startOfDay(now), end: endOfDay(now) };
      case "semana":
        return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfDay(now) };
      case "mes":
        return { start: startOfMonth(now), end: endOfDay(now) };
      case "periodo":
        if (!customFrom || !customTo) return null;
        return { start: startOfDay(new Date(customFrom)), end: endOfDay(new Date(customTo)) };
    }
  }, [period, customFrom, customTo]);

  const { data: rows = [], isLoading } = useMeetingPerformanceBySeller(range);

  const nameOf = (sellerId: string | null) => {
    if (sellerId === null) return "Sem pré-vendas";
    return responsibleMembers.find((m) => m.id === sellerId)?.name ?? "—";
  };

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          marcadas: acc.marcadas + r.marcadas,
          compareceram: acc.compareceram + r.compareceram,
          naoCompareceram: acc.naoCompareceram + r.naoCompareceram,
        }),
        { marcadas: 0, compareceram: 0, naoCompareceram: 0 }
      ),
    [rows]
  );

  return (
    <AnalyticsPanel
      title="Performance por Responsável"
      subtitle="Reuniões por pré-vendedor (por data da reunião)"
    >
      {/* Filtro de período */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="inline-flex rounded-lg border border-border bg-background/40 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                period === p.key
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === "periodo" && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-7 w-[140px] text-xs"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-7 w-[140px] text-xs"
            />
          </div>
        )}
      </div>

      <div className="mt-4">
        {period === "periodo" && !range ? (
          <p className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border/50 rounded-lg">
            Escolha as datas de início e fim do período.
          </p>
        ) : isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border/50 rounded-lg">
            Nenhuma reunião no período.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-1">Pré-vendedor</TableHead>
                <TableHead className="text-right">Marcadas</TableHead>
                <TableHead className="text-right">Compareceu</TableHead>
                <TableHead className="pr-1 text-right">Não compareceu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.sellerId ?? "__none__"}>
                  <TableCell className="pl-1 font-medium">{nameOf(r.sellerId)}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{r.marcadas}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-500">
                    {r.compareceram}
                  </TableCell>
                  <TableCell className="pr-1 text-right tabular-nums text-red-500">
                    {r.naoCompareceram}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-border">
                <TableCell className="pl-1 font-semibold text-muted-foreground">Total</TableCell>
                <TableCell className="text-right font-bold tabular-nums">{totals.marcadas}</TableCell>
                <TableCell className="text-right font-bold tabular-nums text-emerald-500">
                  {totals.compareceram}
                </TableCell>
                <TableCell className="pr-1 text-right font-bold tabular-nums text-red-500">
                  {totals.naoCompareceram}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>
    </AnalyticsPanel>
  );
}
