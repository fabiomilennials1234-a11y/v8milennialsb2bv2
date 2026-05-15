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

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClienteProductsTableProps {
  products: any[];
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
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "projeto":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    default:
      return "bg-zinc-700/30 text-zinc-400 border-zinc-600/20";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ClienteProductsTable({ products }: ClienteProductsTableProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
        <Package size={28} className="text-zinc-700" />
        <p className="text-sm text-zinc-500">Nenhum produto cadastrado</p>
        <p className="text-xs text-zinc-600">Adicione produtos ao vincular pedidos a este cliente.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-zinc-800 hover:bg-transparent">
          <TableHead className="text-zinc-500 text-xs font-medium uppercase tracking-wider pl-0">
            Produto
          </TableHead>
          <TableHead className="text-zinc-500 text-xs font-medium uppercase tracking-wider">
            Tipo
          </TableHead>
          <TableHead className="text-zinc-500 text-xs font-medium uppercase tracking-wider text-right pr-0">
            Valor
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((p) => (
          <TableRow
            key={p.id}
            className="border-zinc-800/60 hover:bg-zinc-800/30 transition-colors"
          >
            <TableCell className="py-2.5 pl-0">
              <span className="text-sm font-medium text-zinc-200 line-clamp-1">
                {p.product_name ?? p.name ?? "—"}
              </span>
            </TableCell>
            <TableCell className="py-2.5">
              <Badge
                variant="outline"
                className={cn("text-[10px] px-1.5 py-0 h-5 border", typeBadgeClass(p.product_type ?? p.type))}
              >
                {typeLabel(p.product_type ?? p.type)}
              </Badge>
            </TableCell>
            <TableCell className="py-2.5 text-right pr-0">
              <span className="text-sm tabular-nums text-zinc-300">
                {p.unit_price != null ? formatBRL(p.unit_price) : "—"}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
