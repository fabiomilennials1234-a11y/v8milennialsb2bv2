/**
 * Leitor do stream de eventos da VPS.
 *
 * `EventSource` nativo não serve aqui: ele não aceita header customizado, e a
 * credencial do stream não pode ir em query string — query vaza para log de
 * proxy, histórico do navegador e Referer. Por isso o transporte é `fetch` com
 * o corpo lido em pedaços.
 *
 * O `fetch` entra por injeção para que o parse — evento partido entre chunks,
 * `data:` de várias linhas, linha de comentário — seja testado sem navegador e
 * sem VPS.
 */

export interface SessionEvent {
  type:
    | "session-qr" | "auth-state" | "session-list" | "call-status"
    | "call-ended" | "call-list" | "incoming" | "incoming-claimed";
  sessionId?: string;
  qr?: string;
  paired?: boolean;
  state?: string;
  [key: string]: unknown;
}

export interface SubscribeArgs {
  vpsUrl: string;
  token: string;
  onEvent: (event: SessionEvent) => void;
  signal: AbortSignal;
  /** Injetado nos testes. Padrão: o fetch global. */
  fetchImpl?: typeof fetch;
}

export async function subscribeSessionEvents(args: SubscribeArgs): Promise<void> {
  const doFetch = args.fetchImpl ?? fetch;
  const response = await doFetch(`${args.vpsUrl.replace(/\/$/, "")}/api/events`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${args.token}`,
      Accept: "text/event-stream",
    },
    signal: args.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`stream de eventos recusado: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // Sobra do chunk anterior. Sem ela, um evento que atravessa a fronteira de
  // dois chunks é perdido sem erro nenhum.
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const payload = raw
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!payload) continue;
        try {
          args.onEvent(JSON.parse(payload) as SessionEvent);
        } catch {
          // Linha que não é JSON não derruba o stream. Heartbeat e comentário
          // do servidor caem aqui.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
