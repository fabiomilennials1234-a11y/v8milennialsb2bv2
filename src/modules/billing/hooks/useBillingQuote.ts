/**
 * useBillingQuote — a cotação do pacote, vinda do MOTOR.
 *
 * O FRONT NUNCA CALCULA PREÇO. Nem o desconto de ciclo, que é uma
 * multiplicação de uma linha e por isso é a tentação óbvia. Quem compõe é
 * `billing_quote_price`, e esta tela só EXIBE a composição que ele devolveu.
 * Duas implementações do mesmo preço divergem no dia em que o catálogo muda, e
 * a que o cliente vê seria a errada.
 *
 * A RPC é `service_role`-only de propósito, então o caminho é a edge function
 * `billing-quote`, que faz o gate de master e repassa. Padrão de autenticação
 * igual ao de `create-gestor`: anon key em `Authorization`, JWT real em
 * `X-User-JWT`.
 *
 * DEBOUNCE, e não é economia de rede: sem ele cada tecla do campo de assentos
 * dispara uma cotação, e a resposta de uma digitação anterior pode chegar
 * DEPOIS da última e sobrescrever o preço na tela com um valor de outro
 * pacote. O `keepPreviousData` existe pelo mesmo motivo, do lado oposto: sem
 * ele o preço pisca em branco a cada ajuste, e preço que pisca é preço em que
 * ninguém confia.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/shared/hooks/useDebounce";

/** A saída literal de `billing_quote_price`. Espelha o jsonb, sem reinterpretar. */
export interface BillingQuote {
  plan_id: string;
  plan_name: string;
  seats: number;
  /** Assentos que o plano JÁ inclui. É o piso: pedir menos não baixa o preço. */
  included_seats: number;
  extra_seats: number;
  billing_cycle: string;
  cycle_months: number;
  payment_method: string | null;
  base_cents: number;
  seat_cents: number;
  subtotal_cents: number;
  cycle_discount_pct: number;
  cycle_discount_cents: number;
  coupon_id: string | null;
  coupon_discount_pct: number;
  coupon_discount_cents: number;
  /** Desconto manual, EM CENTAVOS POR MÊS. Ver o aviso do `manual_final_cents`. */
  manual_discount_cents: number;
  discount_amount_cents: number;
  /** Preço MENSAL final. */
  monthly_cents: number;
  final_amount_cents: number;
  /** O que o cliente paga NESTA cobrança: mensal × meses do ciclo. */
  charge_cents: number;
}

export interface QuoteInput {
  planId: string | null;
  userCount: number;
  billingCycle: string;
  paymentMethod: string | null;
  couponCode: string | null;
  /**
   * ⚠️ PREÇO MENSAL NEGOCIADO, EM CENTAVOS — **NÃO** o total da cobrança.
   *
   * Medido em 2026-08-12, e é a razão de este comentário existir: passar o
   * total de um ciclo anual não dá desconto nenhum. O motor lê o valor como
   * mensal e RECALCULA a cobrança para 12× ele — `manual_discount_cents` volta
   * 0 e o cliente paga doze vezes o previsto, sem erro em lugar nenhum.
   *
   * O nome do parâmetro no banco (`p_manual_final_cents`) não diz "mensal", e
   * é por isso que a renomeação virou a issue #1559. Enquanto ela não roda,
   * este campo se chama `manualFinalMonthlyCents` DE PROPÓSITO: quem escrever
   * a próxima tela lê o nome antes de ler o comentário.
   */
  manualFinalMonthlyCents: number | null;
}

const DEBOUNCE_MS = 350;

async function fetchQuote(input: QuoteInput): Promise<BillingQuote> {
  const { data: sessionData } = await supabase.auth.getSession();
  const jwt = sessionData.session?.access_token;
  if (!jwt) throw new Error("Sessão expirada — entre de novo para cotar.");

  const { data, error } = await supabase.functions.invoke("billing-quote", {
    body: {
      plan_id: input.planId,
      user_count: input.userCount,
      billing_cycle: input.billingCycle,
      payment_method: input.paymentMethod,
      coupon_code: input.couponCode,
      manual_final_cents: input.manualFinalMonthlyCents,
    },
    headers: { "X-User-JWT": jwt },
  });

  if (error) throw error;
  if (!data?.success) {
    // A recusa do motor é MENSAGEM DE NEGÓCIO, não falha técnica: "pix não é
    // vendido no ciclo mensal" é o motor dizendo o que a casa vende. Engolir
    // isso num "erro ao cotar" genérico mandaria o operador procurar problema
    // de rede.
    throw new Error(data?.message || data?.error || "Não foi possível cotar este pacote.");
  }
  return data.quote as BillingQuote;
}

export function useBillingQuote(input: QuoteInput) {
  const debounced = useDebounce(input, DEBOUNCE_MS);

  const query = useQuery({
    queryKey: ["billing-quote", debounced],
    queryFn: () => fetchQuote(debounced),
    enabled: !!debounced.planId && !!debounced.billingCycle,
    placeholderData: (previous) => previous,
    retry: false,
    staleTime: 30_000,
  });

  return {
    ...query,
    /**
     * A cotação exibida está DESATUALIZADA em relação ao que o operador acabou
     * de mexer. A tela precisa saber disso para não deixar gerar link com um
     * preço que já não corresponde ao pacote na tela.
     */
    isStale: query.isFetching || debounced !== input,
  };
}
