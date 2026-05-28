import { useState } from "react";
import { Send, Loader2, MessageSquare, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSendSms, useSmsTemplates } from "@/modules/communication/hooks/useSms";
import { cn } from "@/lib/utils";

interface SmsSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId?: string;
  leadName?: string;
  phoneNumber: string;
  onSent?: () => void;
}

export function SmsSendDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  phoneNumber,
  onSent,
}: SmsSendDialogProps) {
  const sendSms = useSendSms();
  const { data: templates = [] } = useSmsTemplates();
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState<string>("");

  const handleTemplateSelect = (id: string) => {
    setTemplateId(id);
    if (id === "none") {
      setBody("");
      return;
    }
    const tpl = templates.find((t) => t.id === id);
    if (tpl) setBody(tpl.body);
  };

  const handleSend = () => {
    if (!body.trim() || !phoneNumber) return;

    sendSms.mutate(
      {
        leadId,
        toNumber: phoneNumber,
        body: body.trim(),
        templateId: templateId && templateId !== "none" ? templateId : undefined,
      },
      {
        onSuccess: () => {
          setBody("");
          setTemplateId("");
          onOpenChange(false);
          onSent?.();
        },
      }
    );
  };

  const charCount = body.length;
  const segments = Math.ceil(charCount / 160) || 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Enviar SMS
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Recipient */}
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground mb-0.5">Para</p>
            <p className="text-sm font-medium">
              {leadName ? `${leadName} — ` : ""}
              {phoneNumber}
            </p>
          </div>

          {/* Template selector */}
          {templates.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3 h-3" />
                Template
              </label>
              <Select value={templateId} onValueChange={handleTemplateSelect}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecionar template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Body */}
          <div className="space-y-1.5">
            <Textarea
              placeholder="Escreva sua mensagem..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[120px] resize-none text-sm"
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{charCount} caracteres</span>
              <span>
                {segments} segmento{segments > 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Send */}
          <div className="flex justify-end">
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleSend}
              disabled={sendSms.isPending || !body.trim()}
            >
              {sendSms.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Enviar SMS
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
