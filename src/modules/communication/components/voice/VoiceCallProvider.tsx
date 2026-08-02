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
 *
 * ─── Por que a ESCOLHA do número mora aqui, e não no botão ──────────────────
 * Pelo mesmo motivo: `useVoiceCall` recebe o `tcSessionId` na assinatura, e é
 * dele que saem `startCall`, `endCall` e o stream de eventos. Se a escolha
 * morasse no botão, cada tela com um botão teria a sua própria — e a ligação
 * aberta pela tela A seria encerrada com a sessão da tela B.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVoiceCall } from "@/modules/communication/hooks/useVoiceCall";
import { invalidateConversationCalls } from "@/modules/communication/hooks/chat/useConversationCalls";
import {
  useCallableVoiceNumbers,
  type CallableVoiceNumber,
} from "@/modules/communication/hooks/useVoipSession";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { VoiceCallPanel } from "./VoiceCallPanel";

/**
 * A preferência de número é do vendedor, não da sessão do navegador. Vale mais
 * que o padrão de 24 h do `usePersistedState`: quem passa a sexta sem ligar não
 * pode voltar na segunda com outro número selecionado. O TTL segue existindo
 * para que um número aposentado não fique preso na memória do navegador para
 * sempre.
 */
const PREFERENCIA_TELA = "voice-call-number";
const PREFERENCIA_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Janela entre o navegador ver a chamada encerrada e a linha existir em
 * `call_logs` (evento do VPS → webhook → UPDATE em `voip_calls` → gatilho de
 * projeção). Folga deliberada: buscar cedo demais devolve vazio e a ligação só
 * apareceria na próxima troca de conversa.
 */
const PROJECAO_DA_LIGACAO_MS = 2500;

interface VoiceCallContextValue {
  /** true enquanto houver qualquer chamada em andamento. */
  busy: boolean;
  /** Os números ao alcance dele, em ordem estável (por nome). */
  numbers: CallableVoiceNumber[];
  /**
   * Por qual número a próxima ligação sai, e `null` quando não há nenhum ao
   * alcance dele. Isto é o único "tem voz?" do contexto, de propósito: um
   * `available: boolean` ao lado seria uma segunda resposta para a mesma
   * pergunta, livre para discordar desta.
   */
  selected: CallableVoiceNumber | null;
  /** Troca o número da próxima ligação. Ignorada durante uma chamada. */
  selectNumber: (tcSessionId: string) => void;
  startCall: (lead: { id: string; name?: string | null }) => void;
}

const VoiceCallContext = createContext<VoiceCallContextValue>({
  busy: false,
  numbers: [],
  selected: null,
  selectNumber: () => {},
  startCall: () => {},
});

export function useVoiceCallContext() {
  return useContext(VoiceCallContext);
}

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const { numbers } = useCallableVoiceNumbers();
  const [preferido, setPreferido] = usePersistedState<string | null>(
    PREFERENCIA_TELA,
    null,
    { ttlMs: PREFERENCIA_TTL_MS },
  );

  // A última escolha DELE vale mais que a primeira da lista. Quando ela não
  // está mais disponível, cai na primeira em silêncio: o número saiu do alcance
  // dele, e um aviso sobre isso não o ajuda a ligar — só fica entre ele e a
  // próxima ligação. A lista já vem ordenada por nome, então "a primeira" é
  // sempre a mesma, e não o que o Postgres devolver primeiro.
  const selected = useMemo(
    () => numbers.find((n) => n.tcSessionId === preferido) ?? numbers[0] ?? null,
    [numbers, preferido],
  );

  const { state, start, hangup, toggleMute, dismiss } = useVoiceCall(selected?.tcSessionId ?? null);
  const [leadName, setLeadName] = useState<string | null>(null);

  // `failed` e `ended` não contam como ocupado: os dois são cartões de aviso
  // sobre uma chamada que NÃO existe mais, e o vendedor precisa poder discar de
  // novo sem antes fechá-los. Foi exatamente isso que o CTO viveu — a chamada
  // morreu, a fase ficou presa, e o botão respondia "Você já está em uma
  // chamada" para uma chamada que já tinha acabado.
  const busy = state.phase !== "idle" && state.phase !== "failed" && state.phase !== "ended";

  // ── A ligação que acabou precisa aparecer na conversa ──
  // `call_logs` só ganha a linha quando o gatilho do banco projeta a chamada
  // encerrada, e isso acontece DEPOIS que o navegador já viu a fase virar
  // `ended`. Invalidar na hora buscaria cedo demais e voltaria vazio — por isso
  // a espera curta, que cobre o webhook + trigger.
  //
  // Custo: UMA requisição, e só para quem acabou de falar ao telefone. É a
  // alternativa a pendurar um poll no chat, que cobraria de todo mundo o tempo
  // inteiro por um evento que quase nunca acontece.
  // O efeito é chaveado na FASE: só reexecuta quando ela muda, então chegar em
  // `ended` dispara uma vez e repintura nenhuma repete. Não há guarda de
  // transição além disso porque não haveria como provar que ela faz algo.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (state.phase !== "ended" && state.phase !== "failed") return;

    const timer = setTimeout(() => {
      void invalidateConversationCalls(queryClient);
    }, PROJECAO_DA_LIGACAO_MS);
    return () => clearTimeout(timer);
  }, [state.phase, queryClient]);

  const startCall = useCallback(
    (lead: { id: string; name?: string | null }) => {
      setLeadName(lead.name ?? null);
      void start(lead.id);
    },
    [start],
  );

  const selectNumber = useCallback(
    (tcSessionId: string) => {
      // A guarda mora AQUI, no ponto por onde toda troca passa, e não só no
      // botão que a UI desabilita. Trocar o número no meio de uma chamada
      // remontaria `useVoiceCall` com outra sessão: o `endCall` sairia pela
      // sessão errada e a linha ficaria aberta segurando a cota do operador.
      if (busy) return;
      setPreferido(tcSessionId);
    },
    [busy, setPreferido],
  );

  const value = useMemo<VoiceCallContextValue>(
    () => ({
      busy,
      numbers,
      selected,
      selectNumber,
      startCall,
    }),
    [numbers, busy, selected, selectNumber, startCall],
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
