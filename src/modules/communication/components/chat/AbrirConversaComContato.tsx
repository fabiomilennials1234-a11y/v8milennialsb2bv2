/**
 * "WhatsApp" de quem tem vários contatos (Chamado 82c50502).
 *
 * Lead com um telefone: é o `AbrirConversaButton` de sempre. Com 2+, o botão
 * abre a lista dos contatos ("José Luiz - Compras · (17) 98125-7650") e cada
 * linha é o próprio `AbrirConversaButton` daquele número — a regra de caixa
 * (pergunta com mais de uma) continua sendo a dele, não duplicada aqui.
 */
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLeadPhones, rotuloDoTelefone } from "@/modules/leads";
import { AbrirConversaButton } from "./AbrirConversaButton";

export function AbrirConversaComContato({
  leadId,
  phone,
  children,
  variant = "outline",
}: {
  leadId: string;
  /** Telefone principal — usado enquanto a lista não chega ou quando há um só. */
  phone: string | null | undefined;
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
}) {
  const { data: telefones = [] } = useLeadPhones(leadId);
  const [aberto, setAberto] = useState(false);

  if (telefones.length < 2) {
    return (
      <AbrirConversaButton leadId={leadId} phone={telefones[0]?.phone ?? phone} variant={variant}>
        {children}
      </AbrirConversaButton>
    );
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant={variant} data-testid="abrir-conversa-contatos">
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-1.5">
        <p className="px-2 pb-1.5 pt-1 text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground">
          Com quem falar
        </p>
        <ul className="flex flex-col">
          {telefones.map((t) => (
            <li key={t.id}>
              <AbrirConversaButton
                leadId={leadId}
                phone={t.phone}
                variant="ghost"
                className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-left text-[13px] font-normal"
              >
                <MessageCircle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{rotuloDoTelefone(t)}</span>
              </AbrirConversaButton>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
