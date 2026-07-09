/**
 * request-trace — correlação entre o que o usuário fez e o que o backend fez.
 *
 * Duas identidades, propósitos diferentes:
 *
 *   session_id  Uma sessão de navegação. Dado um Chamado, o suporte consulta
 *               `runtime_logs WHERE session_id = X ORDER BY created_at` e
 *               reconstrói a linha do tempo do backend naquela sessão.
 *   request_id  Uma chamada HTTP. Serve quando o Chamado nasce de uma ação
 *               falhada específica.
 *
 * Nada a ver com o `trace_id` do Copilot v2 (`_shared/copilot-v2/trace-context.ts`),
 * que identifica um *turno do agente* — outra granularidade, outra tabela.
 *
 * Ver docs/adr/0017-drop-sentry-for-in-house-runtime-logs.md
 */

export const SESSION_ID_HEADER = "x-torque-session-id";
export const REQUEST_ID_HEADER = "x-torque-request-id";

const SESSION_STORAGE_KEY = "torque:session-id";

let cachedSessionId: string | null = null;

function mintId(): string {
  return crypto.randomUUID();
}

/**
 * O id da sessão de navegação. Estável enquanto a aba viver.
 *
 * `sessionStorage` pode lançar (aba privada em alguns browsers, storage
 * desabilitado). Nesse caso degradamos para um id só em memória: perde-se a
 * estabilidade entre reloads, mas nenhuma chamada ao Supabase quebra por causa
 * de telemetria.
 */
export function getSessionId(): string {
  if (cachedSessionId) return cachedSessionId;

  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      cachedSessionId = stored;
      return stored;
    }
    const minted = mintId();
    sessionStorage.setItem(SESSION_STORAGE_KEY, minted);
    cachedSessionId = minted;
    return minted;
  } catch {
    cachedSessionId = mintId();
    return cachedSessionId;
  }
}

export function newRequestId(): string {
  return mintId();
}

type HeaderInput = HeadersInit | undefined;

/**
 * Carimba os headers de trace preservando o que o chamador já definiu.
 * Um `request_id` fornecido pelo chamador vence — permite amarrar várias
 * chamadas disparadas por uma única ação do usuário.
 */
export function withTraceHeaders(input: HeaderInput): Record<string, string> {
  const headers = new Headers(input);

  headers.set(SESSION_ID_HEADER, getSessionId());
  if (!headers.has(REQUEST_ID_HEADER)) {
    headers.set(REQUEST_ID_HEADER, newRequestId());
  }

  return Object.fromEntries(headers.entries());
}

/**
 * Envolve um `fetch` carimbando os headers de trace em toda saída.
 *
 * Usado como `global.fetch` do client Supabase, o que cobre PostgREST, RPCs,
 * Storage e `functions.invoke()` de uma vez — sem tocar em nenhum call site.
 * Erros do fetch subjacente sobem intactos: telemetria nunca muda o
 * comportamento de erro da chamada.
 */
export function createTracedFetch(baseFetch?: typeof fetch): typeof fetch {
  // Sem o wrapper, o default seria `window.fetch` desligado do seu receiver, e
  // o Chrome lança `Illegal invocation` ao chamá-lo como função solta.
  const send: typeof fetch = baseFetch ?? ((input, init) => fetch(input, init));

  return (input, init) =>
    send(input, { ...init, headers: withTraceHeaders(init?.headers) });
}

/** Apenas para testes — descarta o id em memória. */
export function resetSessionIdForTests(): void {
  cachedSessionId = null;
}
