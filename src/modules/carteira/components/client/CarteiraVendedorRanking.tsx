import { useVendedorRanking } from "@/modules/engagement/hooks/useVendedorRanking";
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

/** Mesmas faixas de antes (80/60), em token. */
function healthBadge(score: number) {
  if (score >= 80) return { className: "bg-success/10 text-success" };
  if (score >= 60) return { className: "bg-warning/15 text-warning-strong" };
  return { className: "bg-destructive/10 text-destructive" };
}

interface CarteiraVendedorRankingProps {
  onFilterByVendedor?: (closerId: string | null) => void;
}

export function CarteiraVendedorRanking({ onFilterByVendedor }: CarteiraVendedorRankingProps) {
  const { data: vendedores = [], isLoading } = useVendedorRanking();

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-card border border-card-border bg-card p-5 shadow-relevo">
        <div className="mb-4 h-4 w-40 rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (vendedores.length === 0) {
    return (
      <div className="rounded-card border border-card-border bg-card p-8 text-center text-sm text-muted-foreground shadow-relevo">
        Nenhum vendedor com clientes atribuídos.
      </div>
    );
  }

  return (
    <section className="rounded-card border border-card-border bg-card p-5 shadow-relevo">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary-soft-foreground">
          <Crown className="h-4 w-4" />
        </span>
        <h3 className="text-[15px] font-bold tracking-[-0.02em] text-foreground">Ranking de vendedores</h3>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {vendedores.length} vendedores
        </span>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="w-10">#</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead className="text-center">Clientes</TableHead>
              <TableHead className="text-center">Ouro</TableHead>
              <TableHead className="text-right">Ticket médio</TableHead>
              <TableHead className="text-center">No prazo</TableHead>
              <TableHead className="text-center">Health</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendedores.map((v, idx) => {
              const badge = healthBadge(v.avg_health);
              return (
                <TableRow
                  key={v.closer_id}
                  onClick={() => onFilterByVendedor?.(v.closer_id)}
                  // Sem handler o cursor de clique prometia uma ação que não existe.
                  className={cn("border-border/60 transition-colors hover:bg-muted/50", onFilterByVendedor && "cursor-pointer")}
                >
                  <TableCell className="text-xs font-bold text-muted-foreground/60 tabular-nums">
                    {idx + 1}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[10.5px] font-bold text-foreground/70">
                        {initials(v.name)}
                      </div>
                      <span className="max-w-[160px] truncate text-sm font-semibold text-foreground">
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
                    <span className="text-xs font-bold tabular-nums text-primary-soft-foreground">
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
                      v.on_time_pct != null && v.on_time_pct >= 70 ? "text-success" : "text-warning-strong",
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
    </section>
  );
}
