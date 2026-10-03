/**
 * `AbrirConversaMenuItem` — a mesma pergunta, dentro de menu.
 *
 * Popover ancorado num `DropdownMenuItem` não funciona: o menu fecha no clique
 * e leva o popover com ele. Dos 9 call sites que vão ao chat interno, 8 são
 * botão e usam `AbrirConversaButton`; este existe para o único que é item de
 * menu (`LeadCard`, variante compacta).
 *
 * A regra é a MESMA — muda só o corpo. Duas regras para a mesma pergunta é
 * como `primaryInstanceId` morreu, então a decisão continua em
 * `decidirAberturaConversa` e a lista continua em `SeletorConversaDoLead`.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import { useConversasDoLead } from "@/modules/communication/hooks/chat/useConversasDoLead";
import { useWhatsAppInstancesForUser } from "@/modules/communication/hooks/chat/useWhatsAppInstances";
import { usePreferredInstance } from "@/modules/communication/hooks/usePreferredInstance";
import { decidirAberturaConversa } from "@/modules/communication/lib/decidirAberturaConversa";
import { SeletorConversaDoLead } from "@/modules/communication/components/chat/SeletorConversaDoLead";

export interface AbrirConversaMenuItemProps {
  leadId: string;
  phone: string | null | undefined;
  children?: React.ReactNode;
}

export function AbrirConversaMenuItem({ leadId, phone, children }: AbrirConversaMenuItemProps) {
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);
  const telefone = formatPhoneForWhatsApp(phone ?? undefined);

  const { data: caixas = [], isLoading } = useConversasDoLead(aberto ? telefone : null);
  const { data: instancias = [] } = useWhatsAppInstancesForUser({ enabled: aberto });
  const { preferredInstanceId } = usePreferredInstance(instancias);

  const irParaConversa = useCallback(
    (instanceId: string) => {
      if (!telefone) return;
      setAberto(false);
      navigate(`/chat?phone=${telefone}&instance=${instanceId}&lead=${leadId}`);
    },
    [telefone, leadId, navigate],
  );

  const decisao = decidirAberturaConversa({ caixas });

  useEffect(() => {
    if (!aberto || isLoading) return;
    if (decisao.acao !== "abrir") return;
    irParaConversa(decisao.instanceId);
  }, [aberto, isLoading, decisao, irParaConversa]);

  if (!telefone) return null;

  return (
    <>
      <DropdownMenuItem
        onSelect={(e) => {
          // Sem isto o menu fecha e desmonta o diálogo junto.
          e.preventDefault();
          setAberto(true);
        }}
      >
        {children}
      </DropdownMenuItem>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="w-auto max-w-none p-0" onClick={(e) => e.stopPropagation()}>
          <DialogHeader className="px-4 pt-4">
            <DialogTitle className="text-sm">Falar com este lead por</DialogTitle>
          </DialogHeader>
          <div className="p-2">
            {isLoading && (
              <div className="flex w-[380px] items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Procurando conversas deste lead…
              </div>
            )}
            {!isLoading && decisao.acao === "sem-caixa" && (
              <p className="w-[380px] px-3 py-4 text-sm text-muted-foreground">
                Nenhum número de WhatsApp disponível nesta organização.
              </p>
            )}
            {!isLoading && decisao.acao === "perguntar" && (
              <SeletorConversaDoLead
                caixas={caixas}
                instanceIdsComEscrita={instancias.map((i) => i.id)}
                preferredInstanceId={preferredInstanceId}
                onEscolher={irParaConversa}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
