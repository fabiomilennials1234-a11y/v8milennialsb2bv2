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
