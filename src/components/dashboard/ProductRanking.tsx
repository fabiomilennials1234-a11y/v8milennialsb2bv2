import { memo, useState } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useProductRanking } from "@/hooks/useProductRanking";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PackageSearch } from "lucide-react";

interface Props { month: number; year: number }

function ProductRankingBase({ month, year }: Props) {
  const { data: products, isLoading } = useProductRanking(month, year);
  const [sortCol, setSortCol] = useState<"total_value" | "qty_sold" | "ticket_medio">("total_value");
  const [sortAsc, setSortAsc] = useState(false);

  if (isLoading) return <Card><CardContent className="p-6"><Skeleton className="h-64" /></CardContent></Card>;

  const sorted = [...(products || [])].sort((a, b) => sortAsc ? a[sortCol] - b[sortCol] : b[sortCol] - a[sortCol]);
  const chartData = sorted.slice(0, 10).map(p => ({ name: p.product_name?.slice(0, 20) || "—", value: p.total_value, type: p.product_type }));

  const fmt = (v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}K` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PackageSearch className="w-4 h-4 text-primary" />
          Produtos Mais Vendidos
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!products?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum produto vendido neste período.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart */}
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <XAxis type="number" tickFormatter={v => fmt(v)} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => `R$ ${v.toLocaleString("pt-BR")}`} contentStyle={{ fontSize: 12, backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px" }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.type === "mrr" ? "hsl(var(--primary))" : "hsl(var(--success))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium text-muted-foreground">Produto</th>
                    <th className="pb-2 font-medium text-muted-foreground">Tipo</th>
                    <th className="pb-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("qty_sold")}>Qtd {sortCol === "qty_sold" ? (sortAsc ? "↑" : "↓") : ""}</th>
                    <th className="pb-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("total_value")}>Total {sortCol === "total_value" ? (sortAsc ? "↑" : "↓") : ""}</th>
                    <th className="pb-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("ticket_medio")}>Ticket {sortCol === "ticket_medio" ? (sortAsc ? "↑" : "↓") : ""}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, i) => (
                    <motion.tr key={p.product_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="border-b border-border/30">
                      <td className="py-2 font-medium truncate max-w-[140px]">{p.product_name}</td>
                      <td className="py-2"><span className={`text-xs px-1.5 py-0.5 rounded ${p.product_type === "mrr" ? "bg-primary/10 text-primary" : "bg-success/10 text-success"}`}>{p.product_type === "mrr" ? "Rec." : "Projeto"}</span></td>
                      <td className="py-2">{p.qty_sold}</td>
                      <td className="py-2 font-medium">{fmt(p.total_value)}</td>
                      <td className="py-2">{fmt(p.ticket_medio)}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const ProductRanking = memo(ProductRankingBase);
