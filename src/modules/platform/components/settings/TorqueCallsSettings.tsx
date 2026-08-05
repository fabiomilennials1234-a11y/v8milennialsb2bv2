import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useOrganization } from "@/modules/identity";
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
  // Master abre esta tela sobre a org que tem selecionada (`selected_org_id`);
  // sem mandar isso pra `logoutVoiceSession`, ele bateria no mesmo 400 que o
  // pareamento — só que no botão "Desconectar" em vez de "Ativar voz".
  const { organizationId } = useOrganization();
  const { data: instances = [], isLoading } = useWhatsAppInstances();
  const { data: sessions = [] } = useVoipSessions();
  const { data: cap = 10 } = useVoiceSessionsCap();
  const [pairing, setPairing] = useState<{ id: string; name: string } | null>(null);
  const [desconectando, setDesconectando] = useState<string | null>(null);

  // ─── Dois predicados, diferentes DE PROPÓSITO ──────────────────────────────
  //
  // TETO = `status !== "closed"`. Uma sessão `pending` já abriu websocket com o
  // WhatsApp e come memória na VPS (~10 MiB medidos): ela ocupa vaga real mesmo
  // sem servir para nada ainda. Só `closed` é sessão morta, senão desconectar
  // nunca liberaria espaço.
  //
  // EXIBIÇÃO de "voz ativa" = `status === "open"`. É o que o RESTO do sistema
  // exige para deixar ligar: `fn_voip_call_reserve` e
  // `_shared/voip/call-plane.ts` recusam com `session_not_open`, e
  // `useCallableVoiceNumbers` (que alimenta o botão de ligar no chat) só
  // enxerga `open`.
  //
  // Não unifique os dois. Estreitar o teto para `open` deixaria o cliente criar
  // sessões `pending` sem limite; alargar a exibição para `!== "closed"` faz a
  // tela afirmar um sucesso que o sistema recusa — que é exatamente o defeito
  // que esta linha conserta.
  //
  // Hoje NADA neste repositório promove `pending`/`pairing` para `open`: quem
  // faria isso é o webhook do S11, que não existe aqui. Por isso
  // "Aguardando confirmação" é, por enquanto, o estado em que o número fica —
  // e é por isso que ele precisa de saída própria.
  const ocupandoVaga = sessions.filter((s) => s.status !== "closed");
  const ativos = ocupandoVaga.length;
  const noTeto = ativos >= cap;

  const sessionDe = (instanceId: string) =>
    ocupandoVaga.find((s) => s.whatsappInstanceId === instanceId);

  // ─── A sessão que CAIU não é a sessão que o cliente DESLIGOU ────────────────
  //
  // As duas terminam em `status = "closed"`, e a tela tratava as duas como
  // ausência: o número voltava a parecer nunca-configurado. Isso escondia os
  // dois fatos que o cliente precisa — que a voz caiu, e que ainda há o que
  // limpar na VPS. E como só sessão não-fechada mostrava "Desconectar", o único
  // caminho de limpeza sumia exatamente na sessão que precisava dele.
  //
  // O QUE SEPARA AS DUAS JÁ ESTÁ NO DADO, e é a chave comercial:
  // `logoutSession` desliga `voice_calls_enabled` junto com o fechamento
  // (torquecalls-control), enquanto o webhook que aplica `failed → closed`
  // não toca nela — ela fica `true` sobre uma sessão morta.
  //
  // Essa divergência É o item 3 da issue ("a instância continua marcada como voz
  // ligada"). A saída NÃO é apagá-la desligando a chave junto com a queda: essa
  // chave é a decisão comercial do admin, e sobrescrevê-la por causa de um
  // soquete que caiu apaga uma decisão humana com um fato de rede — depois disso
  // ninguém distingue "o cliente desligou a voz" de "a conexão caiu ontem". Ela
  // também não devolveria vaga nenhuma (o teto conta `status`, não a chave) nem
  // travaria chamada nenhuma (`fn_voip_call_reserve` já recusa antes, por
  // `session_not_open`). Custaria uma informação e não compraria nada.
  //
  // Então a chave para de ser só uma mentira e vira o SINAL que distingue os
  // dois fechamentos — e a tela deriva o que mostra de "existe sessão viva?",
  // que é o que a issue pede.
  //
  // Lida de forma defensiva: `voice_calls_enabled` existe em produção e vem no
  // `select("*")` de `useWhatsAppInstances`, mas ainda NÃO está em
  // `src/integrations/supabase/types.ts` (gerado de um prod mais velho) — o
  // mesmo motivo que já força os casts em `useVoipSession.ts`. Ausente, o valor
  // cai em `false`, que devolve o comportamento anterior em vez de inventar um
  // alarme.
  const vozLigadaNaInstancia = (inst: unknown): boolean =>
    (inst as { voice_calls_enabled?: boolean }).voice_calls_enabled === true;

  const sessaoQueCaiu = (instanceId: string, inst: unknown) =>
    vozLigadaNaInstancia(inst)
      ? sessions.find((s) => s.whatsappInstanceId === instanceId && s.status === "closed")
      : undefined;

  async function desconectar(tcSessionId: string) {
    setDesconectando(tcSessionId);
    try {
      await logoutVoiceSession({ tcSessionId, organizationId: organizationId ?? undefined });
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
          const caiu = sessao ? undefined : sessaoQueCaiu(inst.id, inst);
          return (
            <div key={inst.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{inst.instance_name}</p>
                <p className="truncate text-xs text-muted-foreground">{inst.phone_number}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {sessao ? (
                  <>
                    {sessao.status === "open" ? (
                      <Badge variant="outline" className="border-success/40 text-success">
                        Voz ativa
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-warning/40 text-warning">
                        Aguardando confirmação
                      </Badge>
                    )}
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
                ) : caiu ? (
                  // A conexão morreu sozinha. Duas ações, porque são coisas
                  // diferentes: "Desconectar" manda a VPS soltar o que sobrou da
                  // sessão morta (é o único caminho do cliente para isso, e era
                  // ele que sumia), e "Ativar voz" é o repareamento. A vaga do
                  // teto já voltou com o `closed`, então reativar não esbarra em
                  // `noTeto` por causa da própria sessão caída.
                  <>
                    <Badge variant="outline" className="border-destructive/40 text-destructive">
                      Voz interrompida
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={desconectando === caiu.tcSessionId}
                      onClick={() => void desconectar(caiu.tcSessionId)}
                    >
                      <PhoneOff className="mr-2 h-4 w-4" />
                      Desconectar
                    </Button>
                    <Button
                      size="sm"
                      disabled={noTeto}
                      onClick={() => setPairing({ id: inst.id, name: inst.instance_name })}
                    >
                      <Phone className="mr-2 h-4 w-4" />
                      Ativar voz
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
