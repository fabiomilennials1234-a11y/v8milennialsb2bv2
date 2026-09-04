import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { VoiceCallButton } from "@/modules/communication/components/voice/VoiceCallButton";
import {
  legendaDoTelefone,
  telefoneParaExibicao,
} from "@/modules/communication/lib/identificadorOculto";

export interface MobileChatThreadHeaderProps {
  contactName: string;
  phoneNumber: string;
  hasLead: boolean;
  leadId?: string;
  onBack: () => void;
  onTapContact: () => void;
}

export function MobileChatThreadHeader({
  contactName,
  phoneNumber,
  hasLead,
  leadId,
  onBack,
  onTapContact,
}: MobileChatThreadHeaderProps) {
  // `contactName` já vem tratado (`nomeDaConversa`); a queda para o telefone é
  // que precisava do mesmo cuidado — sem ela, o cabeçalho mobile se chamava
  // `210028246085780`. Ver `lib/identificadorOculto.ts`.
  const displayName = contactName || telefoneParaExibicao(phoneNumber) || "";
  const initial = (displayName.charAt(0) || "?").toUpperCase();

  return (
    <div className="flex items-center gap-3 h-12 px-3 border-b border-border/60 bg-background shrink-0">
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        className="h-8 w-8 shrink-0 rounded-full"
        aria-label="Voltar para lista"
      >
        <ArrowLeft className="w-5 h-5" />
      </Button>

      <div
        role="button"
        tabIndex={0}
        className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer rounded-lg -my-1 py-1 hover:bg-muted/50 transition-colors"
        onClick={onTapContact}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onTapContact();
        }}
      >
        <Avatar className="w-8 h-8 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{displayName}</p>
          {!hasLead && (
            <p className="text-[11px] text-muted-foreground truncate">
              {legendaDoTelefone(phoneNumber)}
            </p>
          )}
        </div>
      </div>

      {/* Ligar por WhatsApp (TorqueCalls) — a mesma regra do cabeçalho de
          mesa: some sem número de voz ao alcance ou sem lead. Vive fora do
          bloco clicável do contato, e ainda assim segura o clique. */}
      <VoiceCallButton variant="icon" leadId={leadId} leadName={contactName} />
    </div>
  );
}
