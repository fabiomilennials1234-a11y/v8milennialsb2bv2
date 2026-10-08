import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPhoneForWhatsApp } from "../../lib/whatsappPhone";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceName?: string;
  unavailableReason?: string;
  onStart: (phone: string) => void;
}

export function NewConversationDialog({ open, onOpenChange, instanceName, unavailableReason, onStart }: Props) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Conversa</DialogTitle>
          <DialogDescription>
            Informe o WhatsApp com DDD. Não é necessário salvar o contato ou criar um lead.
            {instanceName && ` O envio será pela caixa ${instanceName}.`}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (unavailableReason) return;
          const formatted = /^[+\d\s().-]+$/.test(phone) ? formatPhoneForWhatsApp(phone) : null;
          if (!formatted) {
            setError("Informe um número de WhatsApp válido com DDD.");
            return;
          }
          onStart(formatted);
          onOpenChange(false);
        }}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-conversation-phone">Número de WhatsApp</Label>
            <Input id="new-conversation-phone" type="tel" autoComplete="tel" autoFocus
              placeholder="(48) 99999-9999" value={phone} aria-invalid={!!error}
              aria-describedby={error ? "new-conversation-error" : undefined}
              onChange={(event) => { setPhone(event.target.value); setError(undefined); }} />
            {error && <p id="new-conversation-error" role="alert" className="text-sm text-destructive">{error}</p>}
            {unavailableReason && <p role="alert" className="text-sm text-muted-foreground">{unavailableReason}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!!unavailableReason}>Iniciar conversa</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
