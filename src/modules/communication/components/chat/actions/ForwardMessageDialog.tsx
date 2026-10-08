/**
 * ForwardMessageDialog — escolhe até 5 conversas e encaminha UMA mensagem.
 *
 * O teto de 5 vale no servidor (o envio manual é isento do ritmo do send
 * governor); aqui ele só evita um pedido que o servidor recusaria. Os destinos
 * são as conversas da MESMA caixa da mensagem: o envio sai pelo mesmo número.
 */
import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWhatsAppContacts } from "@/modules/communication/hooks/chat/useWhatsAppContacts";
import { useForwardMessage } from "@/modules/communication/hooks/useMessageActions";

export const FORWARD_MAX_TARGETS = 5;

interface ForwardMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  /** `whatsapp_messages.id` da mensagem de origem (não o `message_id` do provedor). */
  sourceMessageId: string;
  /** Texto ou legenda, só para o usuário reconhecer o que está enviando. */
  preview?: string;
}

interface PickerContact {
  phone_number?: string | null;
  push_name?: string | null;
  saved_contact_name?: string | null;
  lead_name?: string | null;
  is_group?: boolean | null;
}

const labelOf = (c: PickerContact) =>
  c.saved_contact_name?.trim() || c.lead_name?.trim() || c.push_name?.trim() || c.phone_number || "Sem nome";

export function ForwardMessageDialog({ open, onOpenChange, instanceId, sourceMessageId, preview }: ForwardMessageDialogProps) {
  const { data, isLoading } = useWhatsAppContacts(open ? instanceId : null);
  const forward = useForwardMessage();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  // Grupo fica de fora na v1: o seletor lista só conversas 1:1.
  const contacts = useMemo(
    () => ((data ?? []) as PickerContact[]).filter((c) => !!c.phone_number && !c.is_group),
    [data],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => labelOf(c).toLowerCase().includes(q) || (c.phone_number ?? "").includes(q.replace(/\D/g, "") || q));
  }, [contacts, query]);

  const atCap = selected.length >= FORWARD_MAX_TARGETS;
  const toggle = (phone: string) =>
    setSelected((prev) => (prev.includes(phone) ? prev.filter((p) => p !== phone) : prev.length >= FORWARD_MAX_TARGETS ? prev : [...prev, phone]));

  const submit = async () => {
    if (selected.length === 0 || sending) return;
    setSending(true);
    try {
      const { results } = await forward.mutateAsync({ instanceId, sourceMessageId, targets: selected });
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.success(selected.length === 1 ? "Mensagem encaminhada" : `Mensagem encaminhada para ${selected.length} conversas`);
        setSelected([]);
        setQuery("");
        onOpenChange(false);
      } else {
        // Mantém aberto e só os que falharam marcados: o usuário tenta de novo sem refazer a escolha.
        setSelected(failed.map((r) => r.number));
        toast.error(`${failed.length} de ${results.length} não foram enviadas. Tente de novo.`);
      }
    } catch (e) {
      console.warn("[ForwardMessageDialog] forward failed:", e);
      toast.error("Não foi possível encaminhar a mensagem.");
    } finally {
      setSending(false);
    }
  };

  const n = selected.length;
  const confirmLabel = n === 0 ? "Encaminhar" : `Encaminhar para ${n} ${n === 1 ? "conversa" : "conversas"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Encaminhar mensagem</DialogTitle>
          <DialogDescription>Escolha até {FORWARD_MAX_TARGETS} conversas. O envio sai pelo mesmo número.</DialogDescription>
        </DialogHeader>

        {preview && (
          <p className="line-clamp-3 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{preview}</p>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar conversa" className="pl-9" />
        </div>

        <ScrollArea className="h-64">
          {isLoading ? (
            <div className="flex h-full items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada</p>
          ) : (
            <ul className="flex flex-col">
              {filtered.map((c) => {
                const phone = c.phone_number as string;
                const checked = selected.includes(phone);
                const id = `fwd-${phone}`;
                return (
                  <li key={phone}>
                    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                      <Checkbox id={id} checked={checked} disabled={!checked && atCap} onCheckedChange={() => toggle(phone)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{labelOf(c)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{phone}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Cancelar</Button>
          <Button type="button" onClick={submit} disabled={n === 0 || sending}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
