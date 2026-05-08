import { useState } from "react";
import { Send, X, Loader2, Paperclip, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEmailAccounts } from "@/hooks/useEmailAccounts";
import { useSendEmail } from "@/hooks/useEmails";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface EmailComposerProps {
  defaultTo?: string;
  defaultSubject?: string;
  defaultBody?: string;
  inReplyTo?: string;
  threadId?: string;
  leadId?: string;
  contactId?: string;
  onClose?: () => void;
  onSent?: () => void;
  compact?: boolean;
}

export function EmailComposer({
  defaultTo = "",
  defaultSubject = "",
  defaultBody = "",
  inReplyTo,
  threadId,
  leadId,
  contactId,
  onClose,
  onSent,
  compact = false,
}: EmailComposerProps) {
  const { data: accounts } = useEmailAccounts();
  const sendEmail = useSendEmail();

  const [accountId, setAccountId] = useState<string>("");
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [showCc, setShowCc] = useState(false);

  const activeAccounts = accounts?.filter((a) => a.is_active) ?? [];

  const handleSend = () => {
    if (!accountId) {
      toast.error("Selecione uma conta de email");
      return;
    }
    if (!to.trim()) {
      toast.error("Informe o destinatário");
      return;
    }
    if (!subject.trim() && !inReplyTo) {
      toast.error("Informe o assunto");
      return;
    }

    sendEmail.mutate(
      {
        accountId,
        to: to.split(",").map((e) => e.trim()).filter(Boolean),
        cc: cc ? cc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
        subject,
        bodyHtml: `<p>${body.replace(/\n/g, "<br>")}</p>`,
        inReplyTo,
        threadId,
        leadId,
        contactId,
      },
      {
        onSuccess: () => {
          toast.success("Email enviado");
          onSent?.();
          onClose?.();
        },
        onError: (error) => {
          toast.error(`Erro ao enviar: ${error.message}`);
        },
      }
    );
  };

  if (activeAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma conta de email conectada. Conecte uma conta nas configurações.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border bg-card", compact ? "p-3" : "p-4 space-y-3")}>
      {onClose && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">
            {inReplyTo ? "Responder" : "Novo email"}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Selecione a conta" />
          </SelectTrigger>
          <SelectContent>
            {activeAccounts.map((acc) => (
              <SelectItem key={acc.id} value={acc.id}>
                {acc.email_address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Para: email@exemplo.com"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-8 text-xs"
        />

        {!showCc ? (
          <button
            onClick={() => setShowCc(true)}
            className="text-[10px] text-primary hover:underline"
          >
            + Cc
          </button>
        ) : (
          <Input
            placeholder="Cc: email@exemplo.com"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            className="h-8 text-xs"
          />
        )}

        {!inReplyTo && (
          <Input
            placeholder="Assunto"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="h-8 text-xs"
          />
        )}

        <Textarea
          placeholder="Escreva sua mensagem..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-[120px] text-sm resize-none"
        />
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled>
          <Paperclip className="w-3.5 h-3.5" />
          Anexar
        </Button>

        <Button
          size="sm"
          className="gap-1.5"
          onClick={handleSend}
          disabled={sendEmail.isPending || !accountId || !to.trim()}
        >
          {sendEmail.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          Enviar
        </Button>
      </div>
    </div>
  );
}
