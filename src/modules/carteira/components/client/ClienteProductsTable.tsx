import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClienteProductsTableProps {
  products: Tables<"upsell_client_products">[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function typeLabel(type: string | null) {
  switch (type) {
    case "mrr":
      return "Recorrente";
    case "projeto":
      return "Projeto";
    case "unitario":
      return "Unitário";
    default:
      return type ?? "—";
  }
}

function typeBadgeClass(type: string | null) {
  switch (type) {
    case "mrr":
      return "border-transparent bg-success/10 text-success";
    case "projeto":
      return "border-transparent bg-insights/10 text-insights";
    default:
      return "border-transparent bg-muted text-muted-foreground";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ClienteProductsTable({ products }: ClienteProductsTableProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Package size={20} />
        </span>
        <p className="text-sm font-bold text-foreground">Nenhum produto cadastrado</p>
        <p className="text-xs text-muted-foreground">Adicione produtos ao vincular pedidos a este cliente.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border hover:bg-transparent">
          <TableHead className="h-9 pl-0">
            Produto
          </TableHead>
          <TableHead className="h-9">
            Tipo
          </TableHead>
          <TableHead className="h-9 pr-0 text-right">
            Valor
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((p) => (
          <TableRow
            key={p.id}
            className="border-border/60 hover:bg-muted/30 transition-colors"
          >
            <TableCell className="py-2.5 pl-0">
              <span className="text-sm font-medium text-card-foreground line-clamp-1">
                {p.product_name ?? "—"}
              </span>
            </TableCell>
            <TableCell className="py-2.5">
              <Badge
                variant="outline"
                className={cn("h-5 px-2 py-0 text-[10.5px]", typeBadgeClass(p.product_type))}
              >
                {typeLabel(p.product_type)}
              </Badge>
            </TableCell>
            <TableCell className="py-2.5 text-right pr-0">
              <span className="text-sm font-semibold tabular-nums text-card-foreground">
                {p.sale_value != null ? formatBRL(p.sale_value) : "—"}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
