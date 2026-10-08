/**
 * ForwardMessageDialog — escolher a conversa de destino de um encaminhamento.
 *
 * Destino é sempre uma conversa 1:1 que já existe no Torque (decisão de
 * 2026-10-08): número novo seria contato frio, e grupo fica para depois. A
 * mensagem sai pelo número da conversa escolhida — por isso o seletor é por
 * número (caixa) primeiro, e a lista mostra as conversas daquele número.
 *
 * Um destino por vez, de propósito: encaminhar para vários é envio em massa.
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { notifyError } from "@/shared/errors";
import { useWhatsAppInstancesForUser } from "@/modules/communication/hooks/chat/useWhatsAppInstances";
import { useWhatsAppContacts } from "@/modules/communication/hooks/chat/useWhatsAppContacts";
import { contactLabel, type ChatContact } from "@/modules/communication/hooks/chat/types";
import { useForwardMessage } from "@/modules/communication/hooks/useMessageActions";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsappPhone";

export interface ForwardMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chip da conversa de origem. */
  sourceInstanceId: string;
  /** Id do provider da mensagem a encaminhar. */
  sourceMessageId: string;
  /** Telefone da conversa de origem — some da lista de destinos. */
  sourceNumber: string;
}

/** Só a Uazapi marca a mensagem como encaminhada; o servidor recusa os demais. */
const FORWARD_PROVIDERS = new Set(["uazapi"]);

export function ForwardMessageDialog({
  open,
  onOpenChange,
  sourceInstanceId,
  sourceMessageId,
  sourceNumber,
}: ForwardMessageDialogProps) {
  const { data: instances = [] } = useWhatsAppInstancesForUser({ enabled: open });
  const forwardable = useMemo(
    () => instances.filter((i) => FORWARD_PROVIDERS.has(i.provider ?? "")),
    [instances],
  );

  const [chosenInstanceId, setChosenInstanceId] = useState<string | null>(null);
  // Padrão: o próprio número da conversa de origem, quando ele pode encaminhar.
  const instanceId =
    chosenInstanceId ??
    (forwardable.some((i) => i.id === sourceInstanceId) ? sourceInstanceId : forwardable[0]?.id ?? null);

  const { data: contacts = [], isLoading } = useWhatsAppContacts(open ? instanceId : null);
  const sourcePhone = formatPhoneForWhatsApp(sourceNumber);
  const destinations = useMemo(
    () =>
      contacts.filter(
        (c) =>
          !c.is_group &&
          !c.archived_at &&
          !!formatPhoneForWhatsApp(c.phone_number) &&
          !(instanceId === sourceInstanceId && formatPhoneForWhatsApp(c.phone_number) === sourcePhone),
      ),
    [contacts, instanceId, sourceInstanceId, sourcePhone],
  );

  const [selected, setSelected] = useState<ChatContact | null>(null);
  const forwardMut = useForwardMessage();

  const close = (next: boolean) => {
    if (forwardMut.isPending) return;
    if (!next) {
      setSelected(null);
      setChosenInstanceId(null);
    }
    onOpenChange(next);
  };

  const handleForward = async () => {
    if (!selected || !instanceId) return;
    const destNumber = formatPhoneForWhatsApp(selected.phone_number);
    if (!destNumber) return;
    try {
      await forwardMut.mutateAsync({
        destInstanceId: instanceId,
        destNumber,
        sourceInstanceId,
        sourceMessageId,
        destLeadId: selected.lead_id,
      });
      toast.success(`Mensagem encaminhada para ${contactLabel(selected)}`);
      close(false);
    } catch (e) {
      notifyError(e, { fallback: "Não foi possível encaminhar a mensagem." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>Encaminhar mensagem</DialogTitle>
          <DialogDescription>
            Ela sai pelo número da conversa escolhida e chega marcada como encaminhada.
          </DialogDescription>
        </DialogHeader>

        {forwardable.length > 1 && (
          <Select
            value={instanceId ?? undefined}
            onValueChange={(id) => {
              setChosenInstanceId(id);
              setSelected(null);
            }}
          >
            <SelectTrigger aria-label="Número de envio">
              <SelectValue placeholder="Escolha o número" />
            </SelectTrigger>
            <SelectContent>
              {forwardable.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.instance_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Command className="rounded-lg border border-border/70">
          <CommandInput placeholder="Buscar conversa por nome ou telefone" />
          <CommandList className="max-h-72">
            {forwardable.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhum número conectado pela Uazapi pode encaminhar mensagens.
              </p>
            ) : isLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-label="Carregando conversas" />
              </div>
            ) : (
              <>
                <CommandEmpty>Nenhuma conversa encontrada.</CommandEmpty>
                {destinations.map((c) => {
                  const label = contactLabel(c);
                  const isSelected = selected?.phone_number === c.phone_number;
                  return (
                    <CommandItem
                      key={c.phone_number}
                      value={`${label} ${c.phone_number}`}
                      onSelect={() => setSelected(c)}
                      aria-selected={isSelected}
                      className={cn(
                        "flex flex-col items-start gap-0.5 px-3 py-2",
                        isSelected && "bg-accent text-accent-foreground",
                      )}
                    >
                      <span className="w-full truncate text-sm font-medium">{label}</span>
                      {label !== c.phone_number && (
                        <span className="text-xs tabular-nums text-muted-foreground">{c.phone_number}</span>
                      )}
                    </CommandItem>
                  );
                })}
              </>
            )}
          </CommandList>
        </Command>

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={forwardMut.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleForward} disabled={!selected || forwardMut.isPending}>
            {forwardMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Encaminhar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
