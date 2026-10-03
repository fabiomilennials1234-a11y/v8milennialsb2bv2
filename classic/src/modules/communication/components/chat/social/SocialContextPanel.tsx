/**
 * SocialContextPanel — 3ª coluna do chat quando a caixa aberta é social.
 *
 * Um componente e não um ramo no `ChatShellWithContext` porque o shell só
 * precisa saber UMA coisa: "a coluna de contexto de uma conversa social é
 * isto". Qual dos dois estados renderizar — sem lead ou com lead — é decisão do
 * canal, e mantê-la aqui evita que o slot de contexto do shell (compartilhado
 * com o caminho de WhatsApp de 30 orgs) ganhe um segundo ramo a cada canal novo.
 *
 * COM LEAD, O PAINEL É O MESMO DO WHATSAPP. Nada de uma ficha reduzida "de
 * Instagram": header com nome/empresa/score e as três abas (Infos, Histórico,
 * I.A) são a ficha do LEAD, não do canal. O que o canal acrescenta é uma linha
 * de identidade — de qual conta veio, e como desfazer o vínculo.
 */
import { useState } from "react";
import { Loader2, MoreHorizontal, Unlink } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChannelBadge } from "@/modules/communication/components/chat/ChannelBadge";
import { ContextPanel } from "@/modules/communication/components/chat/context-panel/ContextPanel";
import { contactLabel, type SocialContact } from "@/modules/communication/hooks/chat/types";
import { useUnlinkSocialConversation } from "@/modules/communication/hooks/chat/useSocialLeadLink";
import { SocialLeadLinkPanel } from "./SocialLeadLinkPanel";

function SocialIdentityRow({ contact }: { contact: SocialContact }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const unlink = useUnlinkSocialConversation(contact.messaging_channel_id);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 bg-muted/20 shrink-0">
      <ChannelBadge channel="instagram" size={14} />
      <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
        {contactLabel(contact)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0 text-muted-foreground"
            aria-label="Ações do vínculo com o Instagram"
          >
            {unlink.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MoreHorizontal className="h-3.5 w-3.5" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <Unlink className="h-3.5 w-3.5 mr-2" />
            Desvincular lead
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular esta conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead continua existindo — o que sai é a ligação entre ele e esta
              conversa do Instagram, inclusive nas mensagens já recebidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlink.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={unlink.isPending}
              onClick={(e) => {
                e.preventDefault();
                unlink.mutate(
                  { externalUserId: contact.external_user_id },
                  {
                    onSuccess: () => {
                      setConfirmOpen(false);
                      toast.success("Conversa desvinculada");
                    },
                    onError: (error) =>
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Não foi possível desvincular a conversa",
                      ),
                  },
                );
              }}
            >
              {unlink.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Desvincular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export interface SocialContextPanelProps {
  contact: SocialContact;
}

export function SocialContextPanel({ contact }: SocialContextPanelProps) {
  if (!contact.lead_id) {
    return <SocialLeadLinkPanel contact={contact} />;
  }

  return (
    <ContextPanel
      // Sem `phoneNumber`: o lead é resolvido pelo id, e passar telefone vazio
      // faria o painel procurar por `normalized_phone = ''`, que casa com todo
      // contato sem telefone da org.
      leadId={contact.lead_id}
      pushName={contact.display_name}
      identitySlot={<SocialIdentityRow contact={contact} />}
    />
  );
}
