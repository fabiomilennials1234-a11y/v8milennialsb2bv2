/**
 * SendPixButton — botão compacto no pipe_propostas detail.
 *
 * Abre PixChargeDialog com valor preenchido pela proposta. Depende de
 * instância WhatsApp conectada. Esconde quando provider=evolution
 * (feature Uazapi-only — mas o erro vem do proxy como fallback toast).
 */
import { useState } from "react";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PixChargeDialog } from "./PixChargeDialog";

interface Props {
  leadId: string;
  leadPhone: string | null;
  leadName?: string | null;
  saleValue: number;
  instanceId: string | null;
  disabled?: boolean;
}

export function SendPixButton({
  leadId,
  leadPhone,
  leadName,
  saleValue,
  instanceId,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || !leadPhone || saleValue <= 0 || !instanceId}
        onClick={() => setOpen(true)}
        aria-label="Enviar cobrança PIX via WhatsApp"
      >
        <QrCode className="h-3.5 w-3.5 mr-2" />
        Cobrar PIX
      </Button>

      <PixChargeDialog
        open={open}
        onOpenChange={setOpen}
        leadId={leadId}
        leadPhone={leadPhone}
        leadName={leadName}
        defaultAmount={saleValue}
        instanceId={instanceId}
      />
    </>
  );
}
