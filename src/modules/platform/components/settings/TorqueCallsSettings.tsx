import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  logoutVoiceSession,
  useVoiceSessionsCap,
  useVoipSessions,
  useWhatsAppInstances,
  VoiceControlError,
  VoicePairingDialog,
} from "@/modules/communication";

/**
 * Voz não é um número novo: é uma capacidade de um número que a organização já
 * tem no WhatsApp — `voip_sessions.whatsapp_instance_id` é NOT NULL. Por isso
 * a tela é a lista das instâncias, e não um formulário de cadastro.
 */
export function TorqueCallsSettings() {
  const queryClient = useQueryClient();
  const { data: instances = [], isLoading } = useWhatsAppInstances();
  const { data: sessions = [] } = useVoipSessions();
  const { data: cap = 10 } = useVoiceSessionsCap();
  const [pairing, setPairing] = useState<{ id: string; name: string } | null>(null);
  const [desconectando, setDesconectando] = useState<string | null>(null);

  // "closed" é sessão morta — não ocupa vaga no teto, senão desconectar nunca
  // liberaria espaço pro cliente ligar voz em outro número.
  const ativos = sessions.filter((s) => s.status !== "closed").length;
  const noTeto = ativos >= cap;

  const sessionDe = (instanceId: string) =>
    sessions.find((s) => s.whatsappInstanceId === instanceId && s.status !== "closed");

  async function desconectar(tcSessionId: string) {
    setDesconectando(tcSessionId);
    try {
      await logoutVoiceSession({ tcSessionId });
      // A lista e as instâncias mudam juntas: desconectar também desliga
      // `voice_calls_enabled` no servidor.
      await queryClient.invalidateQueries({ queryKey: ["voip_sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    } catch (err) {
      toast({
        title: "Não foi possível desconectar",
        description: err instanceof VoiceControlError ? err.message : "Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setDesconectando(null);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando números…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ligue por WhatsApp a partir do CRM. A voz é ativada num número que você já
        conectou — <strong className="text-foreground">{ativos} de {cap}</strong> em uso.
      </p>

      <div className="space-y-2">
        {instances.map((inst) => {
          const sessao = sessionDe(inst.id);
          return (
            <div key={inst.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{inst.instance_name}</p>
                <p className="truncate text-xs text-muted-foreground">{inst.phone_number}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {sessao ? (
                  <>
                    <Badge variant="outline">Voz ativa</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={desconectando === sessao.tcSessionId}
                      onClick={() => void desconectar(sessao.tcSessionId)}
                    >
                      <PhoneOff className="mr-2 h-4 w-4" />
                      Desconectar
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    disabled={noTeto}
                    onClick={() => setPairing({ id: inst.id, name: inst.instance_name })}
                  >
                    <Phone className="mr-2 h-4 w-4" />
                    Ativar voz
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {instances.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Conecte um número de WhatsApp antes de ativar a voz.
          </p>
        )}
      </div>

      {pairing && (
        <VoicePairingDialog
          instanceId={pairing.id}
          instanceName={pairing.name}
          open
          onOpenChange={(o) => !o && setPairing(null)}
        />
      )}
    </div>
  );
}
