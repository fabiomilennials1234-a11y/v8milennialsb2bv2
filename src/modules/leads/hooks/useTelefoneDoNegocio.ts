import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { telefoneDoNegocio, type TelefoneDoNegocio } from "@/modules/communication/lib/telefoneDoNegocio";
import { useLeadPhones } from "./useLeadPhones";
import type { LeadPhone } from "../lib/lead-phones";

/** `deals.lead_phone_id` do negócio aberto na gaveta. */
export function useTelefoneEscolhidoDoNegocio(dealId: string | null) {
  return useQuery({
    queryKey: ["deal-lead-phone", dealId],
    enabled: !!dealId,
    staleTime: 30_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("deals")
        .select("lead_phone_id")
        .eq("id", dealId!)
        .maybeSingle();
      if (error) throw error;
      return (data as { lead_phone_id: string | null } | null)?.lead_phone_id ?? null;
    },
  });
}

/** A resolução do telefone do negócio — a mesma regra para a faixa e para o "Abrir conversa". */
export function useResolucaoDoTelefoneDoNegocio(
  leadId: string | null,
  dealId: string | null,
): TelefoneDoNegocio<LeadPhone> | null {
  const { data: phones } = useLeadPhones(leadId);
  const { data: escolhido, isLoading } = useTelefoneEscolhidoDoNegocio(dealId);
  return useMemo(() => {
    if (!phones || (dealId && isLoading)) return null;
    return telefoneDoNegocio({ deal: { leadPhoneId: escolhido ?? null }, phones });
  }, [phones, escolhido, isLoading, dealId]);
}
