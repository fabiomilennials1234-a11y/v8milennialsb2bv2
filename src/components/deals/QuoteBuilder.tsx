import { useState, useMemo } from "react";
import { Plus, Send, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useQuotes, useCreateQuote, useUpdateQuoteStatus, Quote, QuoteStatus } from "@/hooks/useQuotes";
import { useDealItems } from "@/hooks/useDealItems";
import { QuotePreview } from "./QuotePreview";

interface QuoteBuilderProps {
  dealId: string;
  dealTitle: string;
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

export function QuoteBuilder({ dealId, dealTitle }: QuoteBuilderProps) {
  const { data: quotes = [], isLoading } = useQuotes(dealId);
  const { data: dealItems = [] } = useDealItems(dealId);
  const createQuote = useCreateQuote();
  const updateStatus = useUpdateQuoteStatus();

  const [showForm, setShowForm] = useState(false);
  const [previewQuote, setPreviewQuote] = useState<Quote | null>(null);
  const [form, setForm] = useState({
    title: "",
    discount_percent: 0,
    tax_percent: 0,
    terms: "",
    valid_until: "",
  });

  const subtotal = useMemo(
    () => dealItems.reduce((s, i) => s + (i.total ?? 0), 0),
    [dealItems],
  );

  const computedTotal = useMemo(() => {
    const afterDiscount = subtotal * (1 - form.discount_percent / 100);
    return afterDiscount * (1 + form.tax_percent / 100);
  }, [subtotal, form.discount_percent, form.tax_percent]);

  async function handleCreate() {
    if (!dealItems.length) {
      toast.error("Adicione itens ao negocio antes de criar a proposta");
      return;
    }

    try {
      await createQuote.mutateAsync({
        deal_id: dealId,
        title: form.title || undefined,
        items: dealItems.map((i) => ({
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          discount_percent: i.discount_percent,
          total: i.total,
        })),
        subtotal,
        discount_percent: form.discount_percent,
        tax_percent: form.tax_percent,
        total: computedTotal,
        terms: form.terms || undefined,
        valid_until: form.valid_until || undefined,
      });
      setShowForm(false);
      setForm({ title: "", discount_percent: 0, tax_percent: 0, terms: "", valid_until: "" });
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao criar proposta");
    }
  }

  function handleStatusChange(quote: Quote, status: QuoteStatus) {
    updateStatus.mutate({ id: quote.id, deal_id: dealId, status });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <FileText className="h-4 w-4" />
          Propostas ({quotes.length})
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} disabled={showForm}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nova proposta
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-4">
          <p className="text-sm font-medium">Nova proposta a partir dos itens atuais</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Titulo (opcional)</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={`Proposta — ${dealTitle}`}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Valido ate</Label>
              <Input
                type="date"
                value={form.valid_until}
                onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                className="h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Subtotal</Label>
              <p className="text-sm font-medium tabular-nums">{formatBRL(subtotal)}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Desconto %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.discount_percent}
                onChange={(e) => setForm({ ...form, discount_percent: parseFloat(e.target.value) || 0 })}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Imposto %</Label>
              <Input
                type="number"
                min={0}
                value={form.tax_percent}
                onChange={(e) => setForm({ ...form, tax_percent: parseFloat(e.target.value) || 0 })}
                className="h-8"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Termos e condicoes</Label>
            <Textarea
              value={form.terms}
              onChange={(e) => setForm({ ...form, terms: e.target.value })}
              placeholder="Condicoes de pagamento, prazos, etc."
              className="min-h-[60px] resize-none"
            />
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm">
              Total: <span className="font-bold text-lg tabular-nums">{formatBRL(computedTotal)}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={createQuote.isPending}>
                {createQuote.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Criar proposta
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Quote list */}
      {quotes.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-border/50 py-8 text-center text-sm text-muted-foreground">
          Nenhuma proposta criada
        </div>
      ) : (
        <div className="space-y-2">
          {quotes.map((q) => {
            const statusConfig = STATUS_MAP[q.status];
            return (
              <div
                key={q.id}
                className="rounded-lg border border-border/50 bg-card/50 p-3 space-y-2 hover:border-border transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {q.title ?? `Proposta v${q.version}`}
                    </span>
                    <Badge className={statusConfig.className}>{statusConfig.label}</Badge>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{formatBRL(q.total)}</span>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>v{q.version}</span>
                  <span>{new Date(q.created_at).toLocaleDateString("pt-BR")}</span>
                  {q.valid_until && (
                    <span>Valido ate {new Date(q.valid_until).toLocaleDateString("pt-BR")}</span>
                  )}
                </div>

                <Separator className="my-1" />

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPreviewQuote(q)}
                  >
                    Visualizar
                  </Button>
                  {q.status === "draft" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleStatusChange(q, "sent")}
                    >
                      <Send className="mr-1 h-3 w-3" /> Marcar enviada
                    </Button>
                  )}
                  {q.status === "sent" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-emerald-500 hover:text-emerald-400"
                        onClick={() => handleStatusChange(q, "accepted")}
                      >
                        Aceita
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-red-500 hover:text-red-400"
                        onClick={() => handleStatusChange(q, "rejected")}
                      >
                        Rejeitada
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview dialog */}
      {previewQuote && (
        <QuotePreview
          quote={previewQuote}
          dealTitle={dealTitle}
          open={!!previewQuote}
          onOpenChange={(open) => !open && setPreviewQuote(null)}
        />
      )}
    </div>
  );
}
