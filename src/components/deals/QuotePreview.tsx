import { FileText, Calendar, Hash } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Quote, QuoteStatus } from "@/hooks/useQuotes";

interface QuotePreviewProps {
  quote: Quote;
  dealTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_MAP: Record<QuoteStatus, { label: string; className: string }> = {
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  sent: { label: "Enviada", className: "bg-blue-500/20 text-blue-400" },
  accepted: { label: "Aceita", className: "bg-emerald-500/20 text-emerald-400" },
  rejected: { label: "Rejeitada", className: "bg-red-500/20 text-red-400" },
  expired: { label: "Expirada", className: "bg-amber-500/20 text-amber-400" },
};

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

interface QuoteLineItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  total: number;
}

export function QuotePreview({ quote, dealTitle, open, onOpenChange }: QuotePreviewProps) {
  const statusConfig = STATUS_MAP[quote.status];
  const items = (quote.items ?? []) as QuoteLineItem[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <DialogTitle>{quote.title ?? `Proposta v${quote.version}`}</DialogTitle>
          </div>
        </DialogHeader>

        {/* Meta row */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <Badge className={statusConfig.className}>{statusConfig.label}</Badge>
          <span className="flex items-center gap-1">
            <Hash className="h-3.5 w-3.5" />
            v{quote.version}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(quote.created_at)}
          </span>
        </div>

        <Separator />

        {/* Deal reference */}
        <div className="text-sm">
          <span className="text-muted-foreground">Negocio: </span>
          <span className="font-medium">{dealTitle}</span>
        </div>

        {/* Items table */}
        {items.length > 0 && (
          <div className="rounded-lg border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 text-xs text-muted-foreground">
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-right px-3 py-2">Qtd</th>
                  <th className="text-right px-3 py-2">Unit.</th>
                  <th className="text-right px-3 py-2">Desc</th>
                  <th className="text-right px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-t border-border/30">
                    <td className="px-3 py-2">{item.product_name}</td>
                    <td className="text-right px-3 py-2 tabular-nums">{item.quantity}</td>
                    <td className="text-right px-3 py-2 tabular-nums">{formatBRL(item.unit_price)}</td>
                    <td className="text-right px-3 py-2 tabular-nums">{item.discount_percent}%</td>
                    <td className="text-right px-3 py-2 font-medium tabular-nums">{formatBRL(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Separator />

        {/* Totals */}
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatBRL(quote.subtotal)}</span>
          </div>
          {quote.discount_percent > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Desconto ({quote.discount_percent}%)</span>
              <span className="text-red-400 tabular-nums">
                -{formatBRL(quote.subtotal * quote.discount_percent / 100)}
              </span>
            </div>
          )}
          {quote.tax_percent > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Impostos ({quote.tax_percent}%)</span>
              <span className="tabular-nums">
                +{formatBRL(quote.subtotal * (1 - quote.discount_percent / 100) * quote.tax_percent / 100)}
              </span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatBRL(quote.total)}</span>
          </div>
        </div>

        {/* Valid until */}
        {quote.valid_until && (
          <p className="text-xs text-muted-foreground">
            Valido ate {formatDate(quote.valid_until)}
          </p>
        )}

        {/* Terms */}
        {quote.terms && (
          <>
            <Separator />
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Termos e condicoes</p>
              <p className="text-sm whitespace-pre-wrap">{quote.terms}</p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
