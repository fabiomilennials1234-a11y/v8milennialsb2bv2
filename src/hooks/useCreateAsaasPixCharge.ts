/**
 * useCreateAsaasPixCharge — cria cobrança PIX dinâmica via Asaas.
 *
 * Backend usado: edge function dedicada `checkout-create-payment` (existe),
 * com flag method="PIX". Retorna pix key + qrcode. Consumido pelo
 * PixChargeDialog no pipe_propostas para enviar botão PIX via WhatsApp
 * após gerar a cobrança.
 */
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PixChargeInput = {
  lead_id: string;
  organization_id: string;
  amount: number; // BRL decimal
  description?: string;
  due_days?: number; // vencimento em dias (default 1)
};

export type PixChargeResult = {
  charge_id: string;
  pixkey: string;
  pixkey_type: "cpf" | "cnpj" | "email" | "phone" | "random" | string;
  merchant_name: string;
  amount: number;
  qr_code_base64?: string;
  invoice_url?: string;
};

export function useCreateAsaasPixCharge() {
  return useMutation({
    mutationFn: async (input: PixChargeInput): Promise<PixChargeResult> => {
      const { data, error } = await supabase.functions.invoke<PixChargeResult>(
        "checkout-create-payment",
        {
          body: {
            method: "PIX",
            lead_id: input.lead_id,
            organization_id: input.organization_id,
            amount: input.amount,
            description: input.description,
            due_days: input.due_days ?? 1,
          },
        }
      );
      if (error) throw new Error(error.message);
      if (!data?.charge_id || !data?.pixkey) {
        throw new Error("Resposta inválida do provedor de pagamento");
      }
      return data;
    },
  });
}
