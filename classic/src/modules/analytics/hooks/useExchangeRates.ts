import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ExchangeRate {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  fetched_at: string;
}

/**
 * Fetches latest exchange rates from exchange_rates table.
 * Distinct on (from_currency, to_currency) ordered by fetched_at desc.
 */
export function useExchangeRates() {
  return useQuery<ExchangeRate[]>({
    queryKey: ["exchange-rates"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("exchange_rates")
        .select("*")
        .order("fetched_at", { ascending: false })
        .limit(50);
      if (error) throw error;

      // Deduplicate: keep only latest per pair
      const seen = new Set<string>();
      const unique: ExchangeRate[] = [];
      for (const row of (data ?? []) as ExchangeRate[]) {
        const key = `${row.from_currency}_${row.to_currency}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(row);
        }
      }
      return unique;
    },
    staleTime: 10 * 60_000, // 10min — rates don't change often
  });
}

/**
 * Convert an amount from one currency to another using available rates.
 * Returns null if no rate found.
 */
export function useConvertCurrency() {
  const { data: rates = [] } = useExchangeRates();

  return function convert(amount: number, from: string, to: string): number | null {
    if (from === to) return amount;

    // Direct rate
    const direct = rates.find((r) => r.from_currency === from && r.to_currency === to);
    if (direct) return amount * direct.rate;

    // Inverse rate
    const inverse = rates.find((r) => r.from_currency === to && r.to_currency === from);
    if (inverse && inverse.rate !== 0) return amount / inverse.rate;

    return null;
  };
}

export const SUPPORTED_CURRENCIES = [
  { code: "BRL", label: "Real (BRL)", symbol: "R$" },
  { code: "USD", label: "Dolar (USD)", symbol: "$" },
  { code: "EUR", label: "Euro (EUR)", symbol: "€" },
] as const;
