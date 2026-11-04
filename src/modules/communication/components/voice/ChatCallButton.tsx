import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { useCanDo, useOrganization } from "@/modules/identity";
import { VoiceCallButton } from "./VoiceCallButton";
import { useVoiceCallContext } from "./VoiceCallProvider";

interface Props {
  leadId?: string | null;
  leadName: string;
  variant?: "default" | "icon";
  onOpenLead?: () => void;
}

/** No chat, o telefone também é a porta de entrada de quem ainda não pode discar. */
export function ChatCallButton({ leadId, leadName, variant = "default", onOpenLead }: Props) {
  const { selected, numbersLoading } = useVoiceCallContext();
  const [open, setOpen] = useState(false);
  const call = useCanDo("voip.call.start");
  const manage = useCanDo("voip.session.manage");
  const features = useOrgFeatures();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const hasVoice = features.isReady && features.hasFeature("voice_calls");
  if (leadId && selected && call.allowed && hasVoice) {
    return <VoiceCallButton leadId={leadId} leadName={leadName} variant={variant} />;
  }

  const checking = numbersLoading || call.isLoading || features.isLoading;
  const needsLead = hasVoice && call.allowed && !!selected && !leadId;
  const canConfigure = !checking && call.allowed && !selected && hasVoice && manage.allowed;
  const reason = checking ? "Verificando as linhas de voz…"
    : !call.allowed ? "Seu usuário não tem permissão para iniciar ligações."
    : needsLead ? "Vincule este contato a um lead com telefone para ligar."
    : !features.isReady ? "Não foi possível verificar a disponibilidade do TorqueCalls."
    : !hasVoice ? "O TorqueCalls não está habilitado para esta organização."
    : canConfigure ? "Ative a voz em um número de WhatsApp da organização para ligar por aqui."
    : "Peça a um administrador acesso a uma linha com voz ativa no TorqueCalls.";

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      // O pareamento pode ter sido feito por outro administrador depois de abrir o chat.
      if (nextOpen && organizationId && hasVoice && call.allowed && !selected && !numbersLoading) {
        void queryClient.invalidateQueries({ queryKey: ["voip_voice_reach", organizationId] });
      }
    }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="Ligar"
          className={variant === "icon" ? "size-8 shrink-0 p-0" : "shrink-0 gap-0"}>
          <PhoneCall className="size-4" aria-hidden />
          {variant !== "icon" && <span className="ml-1.5 hidden lg:inline">Ligar</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Ligação por WhatsApp" className="space-y-2">
        <p className="text-sm font-semibold">Ligação por WhatsApp</p>
        <p className="text-sm text-muted-foreground">{reason}</p>
        {canConfigure && (
          <Button asChild size="sm">
            <Link to="/configuracoes/integracoes?integracao=torquecalls">Configurar TorqueCalls</Link>
          </Button>
        )}
        {!checking && needsLead && onOpenLead && (
          <Button type="button" size="sm" onClick={() => { setOpen(false); onOpenLead(); }}>
            Vincular lead
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
