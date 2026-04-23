/**
 * PixChargeDialog — gera cobrança PIX via Asaas + envia botão WhatsApp
 * para o lead via whatsapp-api-proxy action sendPixButton.
 *
 * Fluxo:
 *  1. User abre modal no pipe_propostas detail
 *  2. Valor default = proposta.sale_value
 *  3. User ajusta valor + texto opcional + clica Enviar
 *  4. useCreateAsaasPixCharge → cria cobrança no Asaas
 *  5. supabase.functions.invoke("whatsapp-api-proxy", { action: "sendPixButton", ... })
 *  6. Toast sucesso → fecha modal
 */
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCreateAsaasPixCharge } from "@/hooks/useCreateAsaasPixCharge";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadPhone: string | null;
  leadName?: string | null;
  defaultAmount: number;
  instanceId: string | null;
}

export function PixChargeDialog({
  open,
  onOpenChange,
  leadId,
  leadPhone,
  leadName,
  defaultAmount,
  instanceId,
}: Props) {
  const [amount, setAmount] = useState(defaultAmount);
  const [text, setText] = useState(
    leadName
      ? `Olá ${leadName}, segue o PIX para pagamento. Tap em "Pagar" para concluir.`
      : `Segue o PIX para pagamento. Tap em "Pagar" para concluir.`
  );
  const [sending, setSending] = useState(false);
  const { data: teamMember } = useCurrentTeamMember();
  const createCharge = useCreateAsaasPixCharge();

  useEffect(() => {
    if (open) setAmount(defaultAmount);
  }, [open, defaultAmount]);

  const canSubmit =
    !!leadPhone &&
    !!instanceId &&
    !!teamMember?.organization_id &&
    amount > 0 &&
    !sending;

  const handleSubmit = async () => {
    if (!canSubmit || !teamMember || !leadPhone || !instanceId) return;
    setSending(true);
    try {
      const charge = await createCharge.mutateAsync({
        lead_id: leadId,
        organization_id: teamMember.organization_id,
        amount,
        description: text,
      });

      const phone = leadPhone.replace(/\D/g, "");
      const { data, error } = await supabase.functions.invoke(
        "whatsapp-api-proxy",
        {
          body: {
            action: "sendPixButton",
            instance_id: instanceId,
            payload: {
              number: phone,
              pixkey: charge.pixkey,
              pixkeyType: charge.pixkey_type,
              amount: charge.amount,
              merchantName: charge.merchant_name,
              text,
            },
          },
        }
      );
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);

      toast.success("Cobrança PIX enviada!");
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Erro ao enviar PIX: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            Cobrar via PIX
          </DialogTitle>
          <DialogDescription>
            Gera uma cobrança dinâmica no Asaas e envia botão "Pagar" no WhatsApp do lead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="pix_amount">Valor (BRL)</Label>
            <Input
              id="pix_amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pix_text">Mensagem acompanhante</Label>
            <Textarea
              id="pix_text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Texto que aparece junto com o botão PIX"
            />
          </div>

          {!leadPhone && (
            <p className="text-xs text-destructive">
              Lead não tem telefone cadastrado.
            </p>
          )}
          {!instanceId && (
            <p className="text-xs text-destructive">
              Selecione uma instância WhatsApp conectada.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {sending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Enviar PIX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
