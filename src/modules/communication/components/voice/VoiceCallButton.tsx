/**
 * Botão de ligar por WhatsApp.
 *
 * Some quando a organização não tem número de voz conectado. Botão que sempre
 * falha é pior que botão ausente: ele ensina o vendedor a desconfiar da tela
 * inteira, e o custo disso não fica restrito a esta feature.
 */
import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVoiceCallContext } from "./VoiceCallProvider";

interface VoiceCallButtonProps {
  leadId?: string | null;
  leadName?: string | null;
  className?: string;
}

export function VoiceCallButton({ leadId, leadName, className }: VoiceCallButtonProps) {
  const voice = useVoiceCallContext();

  // Sem lead não há como ligar: o destino é derivado do lead no servidor, e é
  // essa derivação que sustenta consentimento, fronteira e teto por número.
  if (!voice.available || !leadId) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={voice.busy}
      className={cn("shrink-0", className)}
      title={voice.busy ? "Você já está em uma chamada" : "Ligar por WhatsApp"}
      onClick={(e) => {
        e.stopPropagation();
        voice.startCall({ id: leadId, name: leadName });
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <PhoneCall className="mr-1.5 h-4 w-4" />
      Ligar
    </Button>
  );
}
