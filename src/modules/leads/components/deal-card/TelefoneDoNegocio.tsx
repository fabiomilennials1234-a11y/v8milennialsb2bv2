import { MessageCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import type { TelefoneDoNegocio } from "@/modules/communication/lib/telefoneDoNegocio";
import { notifyError } from "@/shared/errors";
import { useDefinirTelefoneDoNegocio, useLeadPhones } from "../../hooks/useLeadPhones";
import { rotuloDoTelefone, type LeadPhone } from "../../lib/lead-phones";

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
      notifyError(e, { fallback: "Não foi possível escolher o telefone do negócio." });
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
