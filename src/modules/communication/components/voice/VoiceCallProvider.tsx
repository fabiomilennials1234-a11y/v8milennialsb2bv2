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
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVoiceCall } from "@/modules/communication/hooks/useVoiceCall";
import { invalidateConversationCalls } from "@/modules/communication/hooks/chat/useConversationCalls";
import { FASES_EM_CURSO } from "@/modules/communication/lib/callPhases";
import {
  useAnswerableVoiceNumbers,
  useCallableVoiceNumbers,
  type CallableVoiceNumber,
} from "@/modules/communication/hooks/useVoipSession";
import { useIncomingVoiceCalls } from "@/modules/communication/hooks/useIncomingVoiceCalls";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { VoiceCallPanel } from "./VoiceCallPanel";
import { IncomingCallPanel } from "./IncomingCallPanel";

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
  //
  // O gatilho é "a chamada SAIU do ar", não "a fase virou `ended`". A diferença
  // é o caminho mais comum do produto: quando o VENDEDOR desliga, `hangup()`
  // faz `ending` → `setState(INITIAL)`, que é `idle`
  // (`useVoiceCall.ts:613-630`). Ele nunca passa por `ended` — `ended` só é
  // escrito por `finish()` (`useVoiceCall.ts:293-307`), que é o evento da VPS,
  // ou seja, quando o OUTRO lado desliga. Um efeito que olhasse só `ended`
  // ficaria mudo justamente na ligação que o vendedor acabou de fazer.
  //
  // Por isso a marca de "havia chamada" vive num ref: qualquer fase em curso a
  // levanta, e a primeira fase de repouso (`idle`, `ended`, `failed`) dispara a
  // atualização e a abaixa. `ending` NÃO conta como fim — nela o `endCall` ainda
  // está indo ao servidor e a linha de `call_logs` ainda não é final.
  //
  // Custo: UMA requisição, e só para quem acabou de falar ao telefone. É a
  // alternativa a pendurar um poll no chat, que cobraria de todo mundo o tempo
  // inteiro por um evento que quase nunca acontece.
  const queryClient = useQueryClient();
  const houveChamada = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (FASES_EM_CURSO.has(state.phase)) {
      houveChamada.current = true;
      return;
    }
    if (!houveChamada.current) return;
    houveChamada.current = false;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void invalidateConversationCalls(queryClient);
    }, PROJECAO_DA_LIGACAO_MS);

    // SEM cleanup que cancele o timer. Sair da fase não pode desmarcar a
    // atualização: `dismiss()` (`useVoiceCall.ts:642`) leva `ended` → `idle` no
    // instante em que o vendedor clica "Fechar" no cartão
    // (`VoiceCallPanel.tsx:83,105`), e um `clearTimeout` no cleanup engoliria a
    // requisição no caminho mais provável de todos. Só o desmonte cancela.
  }, [state.phase, queryClient]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

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

  // ── As ligações que ENTRAM ──
  //
  // Lista PRÓPRIA, não uma fase de `useVoiceCall`: ver `callPhases.ts`. O
  // conjunto de números vem de `useAnswerableVoiceNumbers`, que responde "quem
  // deve ser chamado?" com a mesma lista do inbox e a permissão da entrada
  // (`voip.call.answer`). Quem não tem número ao alcance não abre stream nenhum,
  // e as duas leituras compartilham `queryKey` com `useCallableVoiceNumbers`
  // acima — nenhuma requisição a mais neste provider, que vive fora das rotas.
  const { numbers: answerable } = useAnswerableVoiceNumbers();
  const { calls: incoming, ringSilenced } = useIncomingVoiceCalls(answerable, {
    // Em chamada, o cartão APARECE e o tom CALA. Um toque por cima da conversa é
    // hostil, e ele não poderia atender a segunda de qualquer jeito; o celular
    // dele continua tocando, que é quem o ADR-0027 deixa decidir.
    ringEnabled: !busy,
  });

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
      {/* A PILHA do canto, e ela é uma só.
          Antes cada painel carregava o próprio `fixed bottom-6 right-6`, o que
          bastava enquanto só existia um. Com a chamada que entra podendo
          aparecer durante uma conversa em curso, dois elementos ancorados no
          mesmo canto se cobririam — e "duas ligações ao mesmo tempo não podem se
          atropelar na tela" é requisito, não detalhe. Numa coluna, empilhar é
          consequência da ordem: as que ENTRAM ficam acima, e a chamada em curso
          fica embaixo, onde o olho do vendedor já está.
          `pointer-events-none` no container para que a faixa vazia da coluna não
          engula cliques da tela atrás; cada painel devolve o seu. */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[320px] flex-col items-end gap-3 [&>*]:pointer-events-auto">
        <IncomingCallPanel calls={incoming} silenced={ringSilenced} />
        <VoiceCallPanel
          state={state}
          leadName={leadName}
          onHangup={() => void hangup()}
          onToggleMute={toggleMute}
          onDismiss={dismiss}
        />
      </div>
    </VoiceCallContext.Provider>
  );
}
