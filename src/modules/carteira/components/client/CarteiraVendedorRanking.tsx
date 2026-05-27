import { useVendedorRanking } from "@/hooks/useVendedorRanking";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Crown, Users } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function healthBadge(score: number) {
  if (score >= 80) return { className: "bg-emerald-500/20 text-emerald-400" };
  if (score >= 60) return { className: "bg-amber-500/20 text-amber-400" };
  return { className: "bg-red-500/20 text-red-400" };
}

interface CarteiraVendedorRankingProps {
  onFilterByVendedor?: (closerId: string | null) => void;
}

export function CarteiraVendedorRanking({ onFilterByVendedor }: CarteiraVendedorRankingProps) {
  const { data: vendedores = [], isLoading } = useVendedorRanking();

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-muted rounded w-40 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (vendedores.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 text-center text-sm text-muted-foreground">
        Nenhum vendedor com clientes atribuídos.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Crown className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Ranking Vendedores</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {vendedores.length} vendedores
        </span>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="w-10 text-[10px]">#</TableHead>
              <TableHead className="text-[10px]">Vendedor</TableHead>
              <TableHead className="text-[10px] text-center">Clientes</TableHead>
              <TableHead className="text-[10px] text-center">Ouro</TableHead>
              <TableHead className="text-[10px] text-right">Ticket Médio</TableHead>
              <TableHead className="text-[10px] text-center">No Prazo</TableHead>
              <TableHead className="text-[10px] text-center">Health</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendedores.map((v, idx) => {
              const badge = healthBadge(v.avg_health);
              return (
                <TableRow
                  key={v.closer_id}
                  onClick={() => onFilterByVendedor?.(v.closer_id)}
                  className="cursor-pointer border-border hover:bg-muted/50 transition-colors"
                >
                  <TableCell className="text-xs font-bold text-muted-foreground/60 tabular-nums">
                    {idx + 1}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                        {initials(v.name)}
                      </div>
                      <span className="text-sm font-medium text-foreground truncate max-w-[160px]">
                        {v.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-xs text-foreground tabular-nums flex items-center justify-center gap-1">
                      <Users className="w-3 h-3 text-muted-foreground" />
                      {v.total_clients}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-xs text-primary tabular-nums font-medium">
                      {v.segments.ouro || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                      {formatBRL(v.avg_ticket)}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={cn(
                      "text-xs font-semibold tabular-nums",
                      v.on_time_pct != null && v.on_time_pct >= 70 ? "text-emerald-400" : "text-amber-500",
                    )}>
                      {v.on_time_pct != null ? `${v.on_time_pct}%` : "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums",
                      badge.className,
                    )}>
                      {v.avg_health}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
