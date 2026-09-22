import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Forward } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useWhatsAppContacts } from "../../../hooks/chat/useWhatsAppContacts";
import { contactLabel } from "../../../hooks/chat/types";
import { DEFAULT_INBOX_FILTER } from "../../../lib/inboxFilter";
import { toServerFilter } from "../../../lib/inboxFilterServer";
import { forwardMessage } from "../../../lib/whatsappApi";

const filter = toServerFilter(DEFAULT_INBOX_FILTER, null, { incluirGrupos: true });

/** Mounted only on demand. Both source and destination are authorized again by the server. */
export function ForwardMessageDialog({ instanceId, rowId, preview, onClose }: {
  instanceId: string;
  rowId: string;
  preview: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [destination, setDestination] = useState("");
  const sending = useRef(false);
  const contacts = useWhatsAppContacts(instanceId, filter);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (number: string) => forwardMessage(instanceId, rowId, number),
    retry: false,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_messages"] });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
      toast.success(
        result.status === "queued" ? "Encaminhamento na fila de envio" : "Mensagem encaminhada",
      );
      onClose();
    },
    onSettled: () => {
      sending.current = false;
    },
  });
  const query = search.trim().toLocaleLowerCase("pt-BR");
  const visible = (contacts.data ?? []).filter((contact) =>
    `${contactLabel(contact)} ${contact.phone_number}`.toLocaleLowerCase("pt-BR").includes(query)
  );
  const selected = (contacts.data ?? []).find((contact) => contact.phone_number === destination);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !sending.current) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Encaminhar mensagem</DialogTitle>
          <DialogDescription>
            Escolha uma conversa deste número de WhatsApp e confirme o envio.
          </DialogDescription>
        </DialogHeader>
        <p className="line-clamp-3 text-sm text-muted-foreground break-words">{preview}</p>
        <Label htmlFor="forward-search">Buscar nas conversas recentes</Label>
        <Input
          id="forward-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={mutation.isPending}
          placeholder="Nome ou número"
        />
        <div className="max-h-64 overflow-y-auto">
          {contacts.isLoading && <p role="status">Carregando conversas…</p>}
          {contacts.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                Não foi possível carregar as conversas.{" "}
                <Button variant="link" onClick={() => void contacts.refetch()}>
                  Tentar novamente
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!contacts.isLoading && !contacts.isError && !visible.length && (
            <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada.</p>
          )}
          <RadioGroup
            value={destination}
            onValueChange={setDestination}
            disabled={mutation.isPending}
            aria-label="Conversa de destino"
          >
            {visible.map((contact, index) => (
              <div key={contact.phone_number} className="flex items-center gap-3 rounded-md p-2">
                <RadioGroupItem value={contact.phone_number} id={`forward-contact-${index}`} />
                <Label
                  htmlFor={`forward-contact-${index}`}
                  className="flex min-w-0 flex-col gap-1 cursor-pointer"
                >
                  <span className="truncate">{contactLabel(contact)}</span>
                  <span className="text-xs text-muted-foreground">
                    {contact.is_group ? "Grupo" : contact.phone_number}
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
        {selected && (
          <p className="text-sm">
            Encaminhar para <strong>{contactLabel(selected)}</strong>
          </p>
        )}
        {mutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>{mutation.error.message}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!selected || mutation.isPending}
            onClick={() => {
              if (!selected || sending.current) return;
              sending.current = true;
              mutation.mutate(destination);
            }}
          >
            <Forward />
            {mutation.isPending ? "Encaminhando…" : "Encaminhar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
