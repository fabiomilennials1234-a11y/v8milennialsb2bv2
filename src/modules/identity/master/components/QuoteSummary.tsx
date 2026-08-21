/**
 * QuoteSummary — a composição do preço, como o MOTOR devolveu.
 *
 * Nenhuma conta acontece aqui. Nem a soma das linhas: cada valor exibido é um
 * campo do `quote`. Se a soma na tela não bater com o total, o defeito é do
 * motor e tem que APARECER, não ser corrigido no caminho por um `reduce` que
 * "conserta" a exibição e esconde a divergência do que o cliente vai pagar.
 *
 * A HIERARQUIA É DELIBERADA: o número grande é o que o cliente PAGA nesta
 * cobrança (`charge_cents`), e o mensal vem logo abaixo como leitura de apoio.
 * Invertê-los é o erro clássico de tela de billing anual — o operador combina
 * "R$ 697 por assento" pensando no mensal e manda o link de um total anual.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { BillingQuote } from "@/modules/billing";

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const CYCLE_LABEL: Record<string, string> = {
  monthly: "mensal",
  semiannual: "semestral",
  annual: "anual",
};

interface QuoteSummaryProps {
  quote: BillingQuote | undefined;
  isLoading: boolean;
  /** A cotação exibida ficou para trás do que está na tela. */
  isStale: boolean;
  error: Error | null;
}

interface LineProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "discount";
}

function Line({ label, value, hint, tone = "default" }: LineProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground truncate">{label}</p>
        {hint && <p className="text-xs text-muted-foreground/70 truncate">{hint}</p>}
      </div>
      <p
        className={cn(
          "text-sm tabular-nums shrink-0",
          tone === "discount" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function QuoteSummary({ quote, isLoading, isStale, error }: QuoteSummaryProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/[0.06] p-4">
        <p className="text-sm font-medium">Este pacote não pode ser cotado</p>
        {/* A mensagem do motor é regra de negócio ("pix não é vendido no ciclo
            mensal"), não falha técnica. Trocá-la por um texto genérico manda o
            operador procurar problema de rede. */}
        <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  if (isLoading && !quote) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-9 w-40 mt-4" />
      </div>
    );
  }

  if (!quote) {
    return (
      <p className="text-sm text-muted-foreground">
        Escolha plano e ciclo para ver a composição do preço.
      </p>
    );
  }

  const cycleLabel = CYCLE_LABEL[quote.billing_cycle] ?? quote.billing_cycle;

  return (
    <div className={cn("transition-opacity", isStale && "opacity-60")}>
      <Line
        label="Base do plano"
        value={brl(quote.base_cents)}
        hint={`${quote.included_seats} assentos inclusos`}
      />
      {quote.seat_cents > 0 && (
        <Line
          label="Assentos adicionais"
          value={brl(quote.seat_cents)}
          hint={`${quote.extra_seats} além do incluso`}
        />
      )}
      <Line label="Subtotal mensal" value={brl(quote.subtotal_cents)} />

      {quote.cycle_discount_cents > 0 && (
        <Line
          label={`Desconto do ciclo ${cycleLabel}`}
          value={`− ${brl(quote.cycle_discount_cents)}`}
          hint={`${quote.cycle_discount_pct}% ao mês`}
          tone="discount"
        />
      )}
      {quote.coupon_discount_cents > 0 && (
        <Line
          label="Cupom"
          value={`− ${brl(quote.coupon_discount_cents)}`}
          hint={`${quote.coupon_discount_pct}% ao mês`}
          tone="discount"
        />
      )}
      {quote.manual_discount_cents > 0 && (
        <Line
          label="Desconto negociado"
          value={`− ${brl(quote.manual_discount_cents)}`}
          hint="por mês"
          tone="discount"
        />
      )}

      <div className="mt-3 pt-3 border-t">
        <p className="text-xs text-muted-foreground">
          Cobrança {cycleLabel} — {quote.cycle_months}{" "}
          {quote.cycle_months === 1 ? "mês" : "meses"}
        </p>
        <p className="text-3xl font-semibold tabular-nums mt-0.5">{brl(quote.charge_cents)}</p>
        {/* O mensal SEMPRE aparece, mesmo no ciclo mensal em que ele é igual ao
            total: é o número que o operador negocia, e escondê-lo no anual
            (onde ele mais importa) obriga a dividir de cabeça por 12. */}
        <p className="text-sm text-muted-foreground mt-0.5">
          equivale a <span className="text-foreground tabular-nums">{brl(quote.monthly_cents)}</span> por mês
        </p>
      </div>

      {isStale && (
        <p className="text-xs text-muted-foreground mt-3">Recalculando com o motor…</p>
      )}
    </div>
  );
}
