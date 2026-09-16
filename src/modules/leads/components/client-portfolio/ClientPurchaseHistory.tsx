import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { portfolioDate, type PortfolioPurchase } from "./portfolio-model";
export function ClientPurchaseHistory({ name, purchases }: { name: string; purchases: PortfolioPurchase[] }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 20;
  return <Dialog open={open} onOpenChange={value => { setOpen(value); setPage(0); }}>
    <DialogTrigger asChild><Button variant="link" className="h-auto p-0 text-xs">Ver todas <span aria-hidden="true" className="ml-1">→</span></Button></DialogTrigger>
    <DialogContent className="z-[60] max-w-lg" overlayClassName="z-[60]" onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}>
      <DialogHeader><DialogTitle>Compras de {name}</DialogTitle><DialogDescription>{purchases.length} compras registradas. Vendas estornadas não aparecem.</DialogDescription></DialogHeader>
      <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
        <table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="p-3">Data</th><th>Origem</th><th className="p-3 text-right">Valor</th></tr></thead>
          <tbody>{purchases.slice(page * pageSize, (page + 1) * pageSize).map(p => <tr key={p.id} className="border-b border-border last:border-0"><td className="p-3">{portfolioDate(p.date)} {p.date.slice(0, 4)}</td><td>{p.source}</td><td className="p-3 text-right tabular-nums">{formatBRL(p.value)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-between"><Button variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button><span className="text-xs text-muted-foreground">Página {page + 1} de {Math.max(1, Math.ceil(purchases.length / pageSize))}</span><Button variant="outline" disabled={(page + 1) * pageSize >= purchases.length} onClick={() => setPage(p => p + 1)}>Próxima</Button></div>
    </DialogContent>
  </Dialog>;
}
