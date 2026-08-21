import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CouponResult {
  valid: boolean;
  discount_pct: number;
  coupon_id: string | null;
  error: string | null;
}

/**
 * Estas frases são lidas por quem está com o cartão na mão. Texto sem acento na
 * hora de pagar lê como sistema improvisado, e a página de checkout é a primeira
 * — às vezes a única — que um não-cliente vê do produto.
 */
const ERROR_MESSAGES: Record<string, string> = {
  COUPON_NOT_FOUND: "Cupom não encontrado.",
  COUPON_INACTIVE: "Este cupom está inativo.",
  COUPON_NOT_YET_VALID: "Este cupom ainda não está válido.",
  COUPON_EXPIRED: "Este cupom está expirado.",
  COUPON_MAX_USES_REACHED: "Este cupom atingiu o limite de usos.",
  COUPON_PLAN_NOT_ELIGIBLE: "Este cupom não se aplica ao plano selecionado.",
};

export function useCouponValidation() {
  const [isValidating, setIsValidating] = useState(false);
  const [result, setResult] = useState<CouponResult | null>(null);

  const validate = useCallback(
    async (code: string, planSlug: string): Promise<CouponResult> => {
      setIsValidating(true);
      setResult(null);

      try {
        const { data, error } = await supabase.rpc("validate_coupon", {
          p_code: code.trim(),
          p_plan_slug: planSlug,
        });

        if (error) {
          const r: CouponResult = {
            valid: false,
            discount_pct: 0,
            coupon_id: null,
            error: "Erro ao validar cupom. Tente novamente.",
          };
          setResult(r);
          return r;
        }

        // The RPC returns JSONB which Supabase parses as an object
        const parsed = data as unknown as CouponResult;
        const r: CouponResult = {
          valid: parsed.valid,
          discount_pct: parsed.valid ? Number(parsed.discount_pct) : 0,
          coupon_id: parsed.coupon_id ?? null,
          error: parsed.error
            ? ERROR_MESSAGES[parsed.error] ?? parsed.error
            : null,
        };
        setResult(r);
        return r;
      } catch {
        const r: CouponResult = {
          valid: false,
          discount_pct: 0,
          coupon_id: null,
          error: "Erro de conexao. Verifique sua internet.",
        };
        setResult(r);
        return r;
      } finally {
        setIsValidating(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setResult(null);
  }, []);

  return { validate, isValidating, result, reset };
}
