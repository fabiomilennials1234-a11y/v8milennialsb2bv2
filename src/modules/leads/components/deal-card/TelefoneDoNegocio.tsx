import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { telefoneDoNegocio, type TelefoneDoNegocio } from "@/modules/communication/lib/telefoneDoNegocio";
import { useDefinirTelefoneDoNegocio, useLeadPhones } from "../../hooks/useLeadPhones";
import { rotuloDoTelefone, type LeadPhone } from "../../lib/lead-phones";

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

/**
 * "Com quem é este negócio" — Chamado 82c50502.
 *
 * Lead com 2+ telefones: o negócio diz com qual contato se fala, e o "Abrir
 * conversa" usa esse número. Sem escolha, PERGUNTA aqui (grava por
 * `definir_telefone_do_negocio`) — nunca chuta o principal. Com um telefone
 * só, não há o que mostrar.
 */
export function TelefoneDoNegocioFaixa({
  leadId,
  dealId,
  resolucao,
}: {
  leadId: string;
  dealId: string | null;
  resolucao: TelefoneDoNegocio<LeadPhone> | null;
}) {
  const definir = useDefinirTelefoneDoNegocio();
  const { data: phones = [] } = useLeadPhones(leadId);

  if (!resolucao || !dealId || phones.length < 2) return null;

  const valor = resolucao.tipo === "escolhido" ? resolucao.telefone.id : "";
  const escolher = async (leadPhoneId: string) => {
    try {
      await definir.mutateAsync({ dealId, leadPhoneId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível escolher o telefone do negócio");
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[14px] border border-card-border bg-card px-3 py-2"
      data-testid="telefone-do-negocio"
    >
      <span className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground">
        Com quem é este negócio
      </span>
      <div className="min-w-[220px] flex-1">
        <Select value={valor} onValueChange={escolher} disabled={definir.isPending}>
          <SelectTrigger className="h-8 text-[12.5px]" aria-invalid={resolucao.tipo === "precisaEscolher"}>
            <SelectValue placeholder="Escolha o contato" />
          </SelectTrigger>
          <SelectContent className="z-[70]">
            {phones.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {rotuloDoTelefone(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {resolucao.tipo === "escolhido" && (
        <AbrirConversaButton leadId={leadId} phone={resolucao.telefone.phone} variant="outline" size="sm">
          <MessageCircle className="mr-1.5 size-3.5" aria-hidden />
          Abrir conversa
        </AbrirConversaButton>
      )}
    </div>
  );
}
