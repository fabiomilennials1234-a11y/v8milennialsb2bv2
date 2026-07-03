import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useProductivityBySeller } from "@/modules/analytics/hooks/useProductivityActivity";
import {
  heldRate,
  heldTone,
  roleLabel,
  initials,
  sellerTotals,
  type HeldTone,
} from "@/modules/analytics/lib/productivity-seller";

const TONE_PILL: Record<HeldTone, string> = {
  good: "text-emerald-500 bg-emerald-500/10",
  warn: "text-amber-500 bg-amber-500/10",
  bad: "text-destructive bg-destructive/10",
  none: "text-muted-foreground/70 bg-muted/50",
};

function fmtRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${rate.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

interface ProductivitySellerBoardProps {
  from: string;
  to: string;
}

/**
 * Placar de produtividade por vendedor — renderizado dentro do bloco Produtividade
 * (aba Performance do Comando), abaixo dos 4 cards, compartilhando o mesmo período.
 */
export function ProductivitySellerBoard({ from, to }: ProductivitySellerBoardProps) {
  const { data: rows = [], isLoading } = useProductivityBySeller(from, to);
  const totals = useMemo(() => sellerTotals(rows), [rows]);
  const totalHeld = totals.reunioes_marcadas > 0
    ? (totals.reunioes_realizadas / totals.reunioes_marcadas) * 100
    : null;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="mb-1 flex items-center gap-2.5">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Por vendedor</h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        O mesmo período, quebrado por pessoa — marcou, compareceu e fechou, cada um pela data-da-ação.
      </p>

      {isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground/70">
          Nenhuma atividade de vendedor neste período.
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="[&>th]:px-3 [&>th]:pb-2.5 [&>th]:text-[10.5px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-[0.06em] [&>th]:text-muted-foreground/70">
                <th className="text-left">Vendedor</th>
                <th className="text-right">Marcadas</th>
                <th className="text-right">Compareceu</th>
                <th className="text-right">Taxa comp.</th>
                <th className="text-right">Fechou</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const rate = heldRate(row);
                const tone = heldTone(rate);
                const role = roleLabel(row.metric_type);
                const barPct = rate === null ? 0 : Math.min(rate, 100);
                return (
                  <tr
                    key={row.seller_id}
                    className="border-t border-border/50 transition-colors hover:bg-secondary/40"
                  >
                    <td className="px-3 py-3 text-left">
                      <div className="flex items-center gap-3">
                        <span className="w-3.5 text-right text-[11px] tabular-nums text-muted-foreground/60">
                          {idx + 1}
                        </span>
                        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[11px] font-bold text-foreground/80">
                          {initials(row.seller_name)}
                        </span>
                        <div>
                          <div className="text-sm font-medium">{row.seller_name}</div>
                          {role && (
                            <div className="mt-0.5 text-[10.5px] text-muted-foreground/60">{role}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-[15px] font-bold tabular-nums">
                      {row.reunioes_marcadas.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-2.5">
                        <span className="h-[5px] w-[76px] shrink-0 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${barPct}%` }} />
                        </span>
                        <span className={cn("text-[15px] font-bold tabular-nums", row.reunioes_realizadas === 0 && "text-muted-foreground/60")}>
                          {row.reunioes_realizadas.toLocaleString("pt-BR")}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={cn("inline-block min-w-[52px] rounded-full px-2.5 py-[3px] text-[11px] font-bold tabular-nums", TONE_PILL[tone])}>
                        {fmtRate(rate)}
                      </span>
                    </td>
                    <td className={cn("px-3 py-3 text-right text-[15px] tabular-nums", row.vendido > 0 ? "font-extrabold text-primary" : "font-bold text-muted-foreground/60")}>
                      {row.vendido.toLocaleString("pt-BR")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="[&>td]:px-3 [&>td]:py-3 [&>td]:text-right [&>td]:text-sm [&>td]:font-bold border-t-2 border-border">
                <td className="!text-left text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Total do período
                </td>
                <td className="tabular-nums">{totals.reunioes_marcadas.toLocaleString("pt-BR")}</td>
                <td className="tabular-nums">{totals.reunioes_realizadas.toLocaleString("pt-BR")}</td>
                <td>
                  <span className={cn("inline-block min-w-[52px] rounded-full px-2.5 py-[3px] text-[11px] font-bold tabular-nums", TONE_PILL[heldTone(totalHeld)])}>
                    {fmtRate(totalHeld)}
                  </span>
                </td>
                <td className="tabular-nums text-primary">{totals.vendido.toLocaleString("pt-BR")}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/75">Como ler:</span> a reunião é creditada a quem{" "}
          <span className="font-medium text-foreground/75">marcou</span> (pré-venda); a venda a quem{" "}
          <span className="font-medium text-foreground/75">fechou</span> (closer). Por isso um pré-venda pode ter
          muitas reuniões e zero vendas, e um closer o contrário.
        </p>
      )}
    </section>
  );
}
