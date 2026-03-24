import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpDown, ChevronRight } from "lucide-react";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import type { UtmCombinedRow, UtmLevel } from "@/hooks/useAnalyticsUtms";

interface Props {
  data: UtmCombinedRow[];
  level: UtmLevel;
  onDrillDown: (name: string, metaId: string | null) => void;
}

type SortKey = keyof Pick<
  UtmCombinedRow,
  "name" | "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "totalLeads" | "conversionRate" | "cpl" | "cac"
>;

const LEVEL_TITLES: Record<string, string> = {
  campaign: "Campanhas",
  adset: "Conjuntos de Anúncios",
  ad: "Anúncios",
};

function formatCurrency(value: number): string {
  if (value === 0) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function cplColor(value: number): string {
  if (value === 0) return "";
  if (value <= 15) return "text-emerald-500";
  if (value <= 40) return "text-yellow-500";
  return "text-red-500";
}

function cacColor(value: number): string {
  if (value === 0) return "";
  if (value <= 100) return "text-emerald-500";
  if (value <= 300) return "text-yellow-500";
  return "text-red-500";
}

export function UtmDataTable({ data, level, onDrillDown }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    if (typeof av === "string" && typeof bv === "string") {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{LEVEL_TITLES[level] || level}</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de UTM no período."
            detail="Verifique se os leads do Meta Ads possuem UTMs preenchidas."
          />
        </CardContent>
      </Card>
    );
  }

  const columns: { key: SortKey; label: string; align?: string }[] = [
    { key: "name", label: "Nome" },
    { key: "spend", label: "Investimento", align: "right" },
    { key: "impressions", label: "Impressões", align: "right" },
    { key: "clicks", label: "Cliques", align: "right" },
    { key: "ctr", label: "CTR", align: "right" },
    { key: "cpc", label: "CPC", align: "right" },
    { key: "totalLeads", label: "Leads", align: "right" },
    { key: "conversionRate", label: "Conversão", align: "right" },
    { key: "cpl", label: "CPL", align: "right" },
    { key: "cac", label: "CAC", align: "right" },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{LEVEL_TITLES[level] || level}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`font-medium text-muted-foreground py-2 px-2 cursor-pointer hover:text-foreground transition-colors ${
                      col.align === "right" ? "text-right" : "text-left"
                    }`}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                ))}
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.id || row.name}
                  className="border-b border-border/40 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => onDrillDown(row.name, row.meta_id)}
                >
                  <td className="py-2 px-2 font-medium max-w-[200px] truncate">{row.name || "—"}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(row.spend)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatNumber(row.impressions)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatNumber(row.clicks)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{row.ctr.toFixed(2)}%</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(row.cpc)}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-medium">{row.totalLeads}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{row.conversionRate.toFixed(1)}%</td>
                  <td className={`py-2 px-2 text-right tabular-nums ${cplColor(row.cpl)}`}>
                    {formatCurrency(row.cpl)}
                  </td>
                  <td className={`py-2 px-2 text-right tabular-nums ${cacColor(row.cac)}`}>
                    {formatCurrency(row.cac)}
                  </td>
                  <td className="py-1 px-1">
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
