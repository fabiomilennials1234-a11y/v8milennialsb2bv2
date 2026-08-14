/**
 * SocialLeadLinkPanel — 3ª coluna do chat ANTES de a conversa ter lead.
 *
 * Este painel substitui uma frase morta ("Conversas do Instagram ainda não são
 * vinculadas a um lead"), que descrevia uma limitação e não oferecia saída
 * nenhuma. O lugar onde a pessoa lê a conversa é o lugar onde ela sabe quem é o
 * contato — é aqui que o vínculo tem de ser possível, não numa tela de leads a
 * três cliques de distância.
 *
 * DUAS SAÍDAS, NESTA ORDEM. "Vincular a lead existente" vem primeiro de
 * propósito: o vínculo desta fatia só impede duplicata pelo eixo do IGSID, e a
 * mesma pessoa pode já estar na base pelo telefone. Oferecer "criar" primeiro
 * ensinaria a produzir a duplicata que ninguém funde depois.
 */
import { useState } from "react";
import { Link2, Loader2, Plus, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ChannelBadge } from "@/modules/communication/components/chat/ChannelBadge";
import { getAvatarGradient } from "@/modules/communication/components/chat/list/avatarGradient";
import { contactLabel, type SocialContact } from "@/modules/communication/hooks/chat/types";
import {
  parseAlreadyLinkedLeadId,
  useCreateLeadFromSocial,
  useLinkSocialConversationToLead,
  useUnlinkSocialConversation,
} from "@/modules/communication/hooks/chat/useSocialLeadLink";
import { useCanDo } from "@/modules/identity";
import { SocialLeadPicker } from "./SocialLeadPicker";
import { SocialCreateLeadDialog } from "./SocialCreateLeadDialog";

/**
 * Nome sugerido para o lead novo.
 *
 * Ordem inversa à de `contactLabel`: na LISTA o `@handle` ganha porque é o que a
 * pessoa vê no app do Instagram; no NOME DO LEAD o nome de exibição é o rótulo
 * humano, e o handle passa a ter campo próprio na identidade. O IGSID cru nunca
 * vira nome — só o sufixo, e só quando não há mais nada.
 */
function suggestedLeadName(contact: SocialContact): string {
  if (contact.display_name?.trim()) return contact.display_name.trim();
  if (contact.handle?.trim()) return `@${contact.handle.trim()}`;
  return `Instagram ${contact.external_user_id.slice(-6)}`;
}

export interface SocialLeadLinkPanelProps {
  contact: SocialContact;
}

export function SocialLeadLinkPanel({ contact }: SocialLeadLinkPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingLeadId, setPendingLeadId] = useState<string | null>(null);
  const [orphanIdentity, setOrphanIdentity] = useState(false);

  const canCreateLead = useCanDo("create_lead");
  const linkMutation = useLinkSocialConversationToLead(contact.messaging_channel_id);
  const createMutation = useCreateLeadFromSocial(contact.messaging_channel_id);
  const unlinkMutation = useUnlinkSocialConversation(contact.messaging_channel_id);

  const label = contactLabel(contact);
  const gradient = getAvatarGradient(contact.external_user_id || label);

  const handleLinkError = (error: unknown) => {
    const alreadyLinked = parseAlreadyLinkedLeadId(error);
    if (alreadyLinked) {
      // A identidade já existe. Se o painel está NESTE estado, a lista não
      // devolveu lead — e o caso que produz as duas coisas ao mesmo tempo é o
      // lead na LIXEIRA: o vínculo continua de pé, a ficha não. Sem uma saída
      // aqui a conversa fica travada, porque vincular e criar batem os dois no
      // mesmo índice único.
      setOrphanIdentity(true);
      setPickerOpen(false);
      setCreateOpen(false);
      toast.error("Esta conversa já está vinculada a um lead que não está mais na lista.");
      return;
    }
    toast.error(
      error instanceof Error ? error.message : "Não foi possível vincular a conversa",
    );
  };

  const handlePick = (leadId: string) => {
    setPendingLeadId(leadId);
    linkMutation.mutate(
      { externalUserId: contact.external_user_id, leadId },
      {
        onSuccess: () => {
          setPendingLeadId(null);
          setPickerOpen(false);
          toast.success("Conversa vinculada ao lead");
        },
        onError: (error) => {
          setPendingLeadId(null);
          handleLinkError(error);
        },
      },
    );
  };

  return (
    <div className="flex flex-col h-full bg-background border-l border-border/60">
      <div className="flex flex-col items-center justify-center h-full gap-5 px-6 text-center">
        <div className="relative">
          {contact.avatar_url ? (
            <img
              src={contact.avatar_url}
              alt=""
              className="w-16 h-16 rounded-full border-2 border-background shadow-sm object-cover"
            />
          ) : (
            <div
              className={cn(
                "w-16 h-16 rounded-full border-2 border-background shadow-sm flex items-center justify-center font-semibold text-lg select-none",
                gradient.ink ? "text-[#1c1c1c]" : "text-white",
              )}
              style={{ background: gradient.background }}
              aria-hidden
            >
              {(label.replace("@", "").charAt(0) || "?").toUpperCase()}
            </div>
          )}
          <ChannelBadge channel="instagram" size={20} overlay />
        </div>

        <div className="flex flex-col items-center gap-1 min-w-0 w-full">
          <span className="text-[15px] font-semibold text-foreground truncate max-w-full">
            {label}
          </span>
          {contact.display_name && contact.handle && (
            <span className="text-xs text-muted-foreground truncate max-w-full">
              {contact.display_name}
            </span>
          )}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[10.5px] font-mono text-muted-foreground/60 truncate max-w-full">
                  ID {contact.external_user_id.slice(-10)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span className="font-mono text-[11px]">{contact.external_user_id}</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex flex-col items-center gap-1">
          <p className="text-sm text-foreground/90">Esta conversa ainda não tem lead.</p>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-[260px]">
            Vincule para que histórico, funil e ficha desta pessoa fiquem no mesmo
            lugar.
          </p>
        </div>

        {orphanIdentity && (
          <div className="w-full max-w-[260px] rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-left">
            <p className="text-xs text-muted-foreground leading-relaxed">
              O vínculo anterior aponta para um lead que foi para a lixeira.
              Desfaça-o para poder vincular de novo.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-7 px-2 text-xs text-destructive hover:text-destructive"
              disabled={unlinkMutation.isPending}
              onClick={() =>
                unlinkMutation.mutate(
                  { externalUserId: contact.external_user_id },
                  {
                    onSuccess: () => {
                      setOrphanIdentity(false);
                      toast.success("Vínculo anterior desfeito");
                    },
                    onError: (error) =>
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Não foi possível desfazer o vínculo",
                      ),
                  },
                )
              }
            >
              {unlinkMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Unlink className="w-3.5 h-3.5 mr-1.5" />
              )}
              Desfazer vínculo anterior
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2 w-full max-w-[260px]">
          <Button
            className="w-full"
            onClick={() => setPickerOpen(true)}
            disabled={linkMutation.isPending}
          >
            {linkMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Link2 className="w-4 h-4 mr-2" />
            )}
            Vincular a lead existente
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setCreateOpen(true)}
            disabled={createMutation.isPending || !canCreateLead.allowed}
            title={
              canCreateLead.allowed ? undefined : "Você não tem permissão para criar leads"
            }
          >
            {createMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            Criar lead
          </Button>
        </div>
      </div>

      <SocialLeadPicker
        open={pickerOpen}
        onOpenChange={(next) => {
          if (!linkMutation.isPending) setPickerOpen(next);
        }}
        initialQuery={contact.display_name ?? ""}
        onPick={handlePick}
        isSubmitting={linkMutation.isPending}
        pendingLeadId={pendingLeadId}
      />

      <SocialCreateLeadDialog
        open={createOpen}
        onOpenChange={(next) => {
          if (!createMutation.isPending) setCreateOpen(next);
        }}
        suggestedName={suggestedLeadName(contact)}
        isSubmitting={createMutation.isPending}
        onSubmit={(values) =>
          createMutation.mutate(
            {
              ...values,
              messagingChannelId: contact.messaging_channel_id,
              externalUserId: contact.external_user_id,
            },
            {
              onSuccess: () => {
                setCreateOpen(false);
                toast.success("Lead criado e vinculado à conversa");
              },
              onError: handleLinkError,
            },
          )
        }
      />
    </div>
  );
}
