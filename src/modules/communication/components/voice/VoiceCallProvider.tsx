/**
 * Host da chamada de voz.
 *
 * Existe por um motivo estrutural, não por organização de código: a chamada
 * precisa sobreviver à tela que a originou. O vendedor liga a partir do modal do
 * lead, fecha o modal para consultar outra coisa, e continua falando. Se o
 * estado da chamada morasse no componente que tem o botão, fechar o modal
 * desmontaria a `RTCPeerConnection` e derrubaria a ligação no meio.
 *
 * Por isso: um provider único, montado na raiz, e o botão só dispara uma ação.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useVoiceCall } from "@/modules/communication/hooks/useVoiceCall";
import { useVoipSession } from "@/modules/communication/hooks/useVoipSession";
import { VoiceCallPanel } from "./VoiceCallPanel";

interface VoiceCallContextValue {
  /** true quando a organização tem número de voz conectado. */
  available: boolean;
  /** true enquanto houver qualquer chamada em andamento. */
  busy: boolean;
  startCall: (lead: { id: string; name?: string | null }) => void;
}

const VoiceCallContext = createContext<VoiceCallContextValue>({
  available: false,
  busy: false,
  startCall: () => {},
});

export function useVoiceCallContext() {
  return useContext(VoiceCallContext);
}

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const { data: session } = useVoipSession();
  const { state, start, hangup, toggleMute, dismiss } = useVoiceCall(session?.tc_session_id ?? null);
  const [leadName, setLeadName] = useState<string | null>(null);

  const startCall = useCallback(
    (lead: { id: string; name?: string | null }) => {
      setLeadName(lead.name ?? null);
      void start(lead.id);
    },
    [start],
  );

  const value = useMemo<VoiceCallContextValue>(
    () => ({
      available: !!session?.tc_session_id,
      // `failed` não conta como ocupado: o vendedor precisa poder tentar de novo
      // sem antes fechar um aviso.
      busy: state.phase !== "idle" && state.phase !== "failed",
      startCall,
    }),
    [session?.tc_session_id, state.phase, startCall],
  );

  return (
    <VoiceCallContext.Provider value={value}>
      {children}
      <VoiceCallPanel
        state={state}
        leadName={leadName}
        onHangup={() => void hangup()}
        onToggleMute={toggleMute}
        onDismiss={dismiss}
      />
    </VoiceCallContext.Provider>
  );
}
