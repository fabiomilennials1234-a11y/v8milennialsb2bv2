/**
 * Sentry das edge functions (ADR-0038, S6) — só a exceção NÃO tratada.
 *
 * Quem chama é o `withErrorBoundary`, no caminho do 500. Erro tratado (a
 * função decidiu devolver 4xx/5xx) continua no `runtime_logs`; aqui entra o que
 * escapou de toda função — o defeito.
 *
 * Decisões:
 * - Sem `SENTRY_DSN_EDGE`, nada carrega e nada sai.
 * - O SDK chega por import dinâmico, no caminho do erro: as ~80 funções
 *   importam o boundary, e nenhuma delas paga o parse do SDK no cold start de
 *   uma requisição que dá certo.
 * - `defaultIntegrations: false`, como a documentação do Supabase manda: as
 *   integrações padrão instrumentam o processo inteiro, e o isolate do edge
 *   runtime atende várias requisições — o escopo de uma vazaria para outra.
 *   Cada captura vai num `withScope` próprio.
 * - O envio não segura a resposta: `EdgeRuntime.waitUntil` quando existe.
 * - Mesma régua de dado do front: telefone/e-mail/CPF/CNPJ mascarados, do
 *   usuário só o UUID.
 * - A URL da requisição NÃO vai: webhook guarda segredo no path
 *   (`whatsapp-webhook/<segredo>`), e o nome da função já diz onde foi. URL
 *   dentro de mensagem de exceção (o erro de `fetch` do Deno traz a URL inteira,
 *   com `?access_token=` da Graph API) perde query e fragmento.
 */

import { scrubText } from "./scrub.ts";

type SentryModule = typeof import("npm:@sentry/deno@11.1.0");

export interface UnhandledContext {
  functionName: string;
  requestId: string;
  sessionId?: string | null;
  userId?: string;
  method: string;
}

/** Os campos do evento que esta camada toca — o resto passa como veio. */
export interface EdgeEvent {
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  request?: { url?: string; method?: string };
  user?: { id?: string | number; ip_address?: string | null };
  extra?: unknown;
  server_name?: string;
}

export function prepareEdgeEvent<T extends EdgeEvent>(event: T): T {
  const e: EdgeEvent = event;
  if (typeof e.message === "string") e.message = scrubText(e.message);
  for (const exception of e.exception?.values ?? []) {
    if (typeof exception.value === "string") exception.value = scrubText(exception.value);
  }
  // Só o método: a URL pode ter segredo no path, e header/corpo não são nossos.
  if (e.request) e.request = e.request.method ? { method: e.request.method } : {};
  // `ip_address: null`: sem isso o Sentry deduz a localização pelo IP da conexão.
  e.user = e.user?.id ? { id: e.user.id, ip_address: null } : { ip_address: null };
  delete e.extra;
  delete e.server_name;
  return event;
}

let loading: Promise<SentryModule | null> | null = null;

function dsn(): string | undefined {
  return Deno.env.get("SENTRY_DSN_EDGE")?.trim() || undefined;
}

function load(): Promise<SentryModule | null> {
  if (loading) return loading;
  const configured = dsn();
  if (!configured) return Promise.resolve(null);

  loading = import("npm:@sentry/deno@11.1.0")
    .then((Sentry) => {
      Sentry.init({
        dsn: configured,
        defaultIntegrations: false,
        environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "production",
        release: Deno.env.get("SENTRY_RELEASE") || undefined,
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          databaseQueryData: false,
          queues: false,
          stackFrameVariables: false,
          genAI: { inputs: false, outputs: false },
        },
        initialScope: { tags: { app: "torque-edge", region: Deno.env.get("SB_REGION") ?? "unknown" } },
        beforeSend: prepareEdgeEvent,
      });
      return Sentry;
    })
    .catch((error) => {
      console.error("[sentry] SDK não carregou:", error instanceof Error ? error.message : String(error));
      loading = null; // tenta de novo no próximo erro
      return null;
    });
  return loading;
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function inBackground(task: Promise<unknown>): Promise<void> {
  const safe = task.then(() => undefined, () => undefined);
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") {
    EdgeRuntime.waitUntil(safe);
    return Promise.resolve();
  }
  return safe;
}

/**
 * Relata a exceção que escapou da função. Nunca lança, e não segura a resposta
 * quando o runtime oferece `waitUntil`. O `request_id` é o mesmo da resposta 500
 * e da linha do `runtime_logs` — o suporte acha o evento pelo que o cliente vê.
 */
export function captureUnhandled(error: unknown, context: UnhandledContext): Promise<void> {
  if (!dsn()) return Promise.resolve();

  return inBackground(
    load().then(async (Sentry) => {
      if (!Sentry) return;
      Sentry.withScope((scope) => {
        scope.setTags({
          // `function` é chave reservada no Sentry (busca da pilha) e o servidor
          // dele descarta a tag — medido na validação. Por isso `edge_function`.
          edge_function: context.functionName,
          request_id: context.requestId,
          ...(context.sessionId ? { session_id: context.sessionId } : {}),
        });
        if (context.userId) scope.setUser({ id: context.userId });
        scope.setContext("request", { method: context.method });
        Sentry.captureException(error instanceof Error ? error : new Error(scrubText(String(error))));
      });
      await Sentry.flush(2000);
    }),
  );
}
