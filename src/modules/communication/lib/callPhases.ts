/**
 * Partição das fases de `useVoiceCall`: existe chamada no ar, ou não existe.
 *
 * Mora fora do `VoiceCallProvider` por duas razões. A boba: exportar constante
 * de um arquivo de componente quebra o Fast Refresh. A que importa: quem decide
 * "a chamada acabou" precisa desta partição, e ela é uma afirmação sobre a
 * máquina de estados — não sobre a árvore de React.
 *
 * ── Por que a decisão é por COMPLEMENTO ──
 * O provider dispara a atualização da conversa quando a fase sai de "em curso"
 * para qualquer fase de repouso. Olhar só `ended` não serve: `ended` é escrito
 * apenas por `finish()` (`useVoiceCall.ts:293-307`), o evento da VPS — ou seja,
 * quando o OUTRO lado desliga. Quando o VENDEDOR desliga, `hangup()`
 * (`useVoiceCall.ts:613-630`) faz `ending` → `setState(INITIAL)`, e
 * `INITIAL.phase` é `"idle"`: nunca passa por `ended` nem por `failed`.
 *
 * `callPhases.test.ts` trava que os dois conjuntos cobrem `CallPhase` inteiro —
 * uma fase nova não pode cair no repouso por omissão e fazer uma chamada viva
 * parecer terminada.
 *
 * ── A ligação que ENTRA e ainda não foi atendida NÃO tem fase aqui ──
 * E a ausência é decidida, não esquecida. `CallPhase` descreve UMA chamada que
 * ESTE operador possui: `useVoiceCall` guarda um `tcCallIdRef`, um
 * `RTCPeerConnection` e um microfone, todos no singular. Uma oferta de entrada
 * não cabe em nenhuma das duas condições — ela não tem dono
 * (`voip_calls.operator_user_id` nasce nulo, e é justamente por isso que o
 * índice `idx_voip_calls_one_live_per_operator` a deixa coexistir com outras), e
 * N delas podem estar tocando ao mesmo tempo.
 *
 * Classificá-la aqui obrigaria a escolher entre dois erros: em `FASES_EM_CURSO`,
 * um estranho ligando para o número da empresa deixaria `busy === true` e
 * tiraria do vendedor o botão de discar; em `FASES_DE_REPOUSO`, o provider
 * trataria a oferta viva como terminada e dispararia a atualização da conversa
 * no meio dela. As ofertas moram em `useIncomingVoiceCalls`, numa LISTA, que é a
 * forma que corresponde ao fato.
 *
 * Quando alguém ATENDER (E4), aí sim a chamada passa a ter dono e entra nesta
 * máquina — provavelmente pelas fases que já existem, porque atender é pedir
 * microfone, autorizar e negociar, na mesma ordem. Se uma fase nova for
 * necessária, é AQUI que o compilador vai cobrá-la.
 */
import type { CallPhase } from "@/modules/communication/hooks/useVoiceCall";

/**
 * Há uma chamada no ar.
 *
 * `ending` está AQUI, e não no repouso, porque nela o `endCall` ainda está a
 * caminho do servidor — a linha de `call_logs` só é final depois dele.
 */
export const FASES_EM_CURSO: ReadonlySet<CallPhase> = new Set<CallPhase>([
  "requesting_mic",
  "authorizing",
  "negotiating",
  "ringing",
  "active",
  "ending",
]);

/** Complemento de `FASES_EM_CURSO`: não há chamada no ar. */
export const FASES_DE_REPOUSO: ReadonlySet<CallPhase> = new Set<CallPhase>([
  "idle",
  "ended",
  "failed",
]);

/**
 * A rede que impede a próxima fase de escapar — e ela vive AQUI, no arquivo de
 * produção, não no teste.
 *
 * Duas tentativas anteriores não guardavam nada, e as duas pareciam guardar:
 *
 *  1. `as const satisfies readonly CallPhase[]` só checa que cada item É uma
 *     fase. Nunca que TODAS as fases estão listadas.
 *  2. `const x: FaltamClassificar[] = []` também passa sempre, porque array
 *     vazio é atribuível a array de qualquer tipo — inclusive de `never`.
 *
 * O que funciona é obrigar o compilador a provar que o conjunto das fases não
 * classificadas é vazio. `Exige<T extends never>` só aceita `never`; se alguém
 * acrescentar uma fase ao union de `useVoiceCall` e esquecer de classificá-la
 * aqui, `FASE_NAO_CLASSIFICADA` deixa de ser `never` e a COMPILAÇÃO REPROVA,
 * nomeando a fase esquecida no erro. Provado plantando `"reconnecting"`:
 * `error TS2344: Type '"reconnecting"' does not satisfy the constraint 'never'`.
 *
 * Por que isso merece uma rede: uma fase não classificada cai no repouso por
 * omissão. O provider então trata uma chamada VIVA como terminada, dispara a
 * atualização no meio dela, e o fim real fica mudo — o mesmo defeito que fazia
 * a ligação não aparecer quando o vendedor desligava.
 */
type Exige<T extends never> = T;
export type FASE_NAO_CLASSIFICADA = Exige<
  Exclude<CallPhase, "idle" | "requesting_mic" | "authorizing" | "negotiating"
    | "ringing" | "active" | "ending" | "ended" | "failed">
>;
