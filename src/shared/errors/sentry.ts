import { addBreadcrumb, addIntegration, captureException, init, withScope } from "@sentry/react";
import { addErrorReporter, type ErrorReport } from "./report";
import { exceptionFor, fingerprintFor, prepareEvent, scrubBreadcrumb, scrubRecordingEvent, tagsFor } from "./sentry-event";

/**
 * O Sentry do navegador (ADR-0038, S6). Observa exceção; não mostra nada.
 *
 * Este módulo é o único que importa o SDK, e só entra por import dinâmico
 * (`sentry-loader.ts`) quando há DSN: sem DSN o SDK nem chega ao navegador, e o
 * barrel `@/shared/errors` continua sem ele — a rota pública de preview não pode
 * alcançá-lo.
 *
 * Decisões:
 * - `dataCollection` todo desligado. O padrão do SDK coleta cookie, header,
 *   corpo e query string; nada disso é necessário para achar um defeito, e tudo
 *   isso carrega dado de lead. `prepareEvent` é a segunda camada.
 * - Sem tracing: o que se quer aqui é o defeito e o passo a passo até ele, e o
 *   rastro (clique, navegação, requisição) já dá o passo a passo.
 * - Replay só no erro, todo mascarado, carregado depois que a página assenta.
 * - Sem a integração do Supabase do SDK: todo erro do Supabase já passa pelo
 *   contrato, e ela relataria de novo o que o reporter relata — cota queimada
 *   duas vezes pelo mesmo defeito.
 */

export interface SentryOptions {
  dsn: string;
  environment: string;
  release: string;
  /** 0 a 1. Fração dos erros relatados que levam a gravação do minuto anterior. */
  replayOnErrorRate: number;
}

/**
 * Mensagens que não são defeito nosso nem acionáveis:
 * - chunk velho depois de deploy (o `main.tsx` recarrega a página);
 * - o aviso benigno do ResizeObserver, que todo navegador dispara.
 */
const IGNORED_ERRORS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /ChunkLoadError/i,
  /Loading chunk \d+ failed/i,
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i,
];

/** Erro que nasce em extensão do navegador do cliente não é nosso. */
const EXTENSION_URLS = [/^chrome-extension:\/\//i, /^moz-extension:\/\//i, /^safari(-web)?-extension:\/\//i];

function sentryReporter({ error, context }: ErrorReport): void {
  // Recusa esperada (validação, sessão vencida, recusa deliberada) não é
  // defeito: vira rastro, e aparece no passo a passo do próximo evento.
  if (!error.reportable) {
    addBreadcrumb({
      category: "app.error",
      level: "info",
      message: `${error.code} · ${error.reference}`,
      data: context,
    });
    return;
  }

  withScope((scope) => {
    scope.setTags(tagsFor(error, context));
    scope.setContext("app_error", {
      code: error.code,
      reference: error.reference,
      retryable: error.retryable,
      action: error.action?.kind ?? null,
    });
    const fingerprint = fingerprintFor(error, context);
    if (fingerprint) scope.setFingerprint(fingerprint);
    captureException(exceptionFor(error));
  });
}

function whenIdle(task: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(task, { timeout: 10_000 });
  } else {
    window.setTimeout(task, 3_000);
  }
}

async function startReplay(): Promise<void> {
  const { replayIntegration } = await import("./sentry-replay");
  addIntegration(
    replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
      networkDetailAllowUrls: [],
      beforeAddRecordingEvent: scrubRecordingEvent,
    }),
  );
}

/**
 * Liga o Sentry e passa a receber os relatórios. `pending` são os que chegaram
 * enquanto o SDK carregava — erro de boot é justamente o que mais importa.
 * Devolve a função que para de encaminhar relatórios ao SDK.
 */
export function initSentry(options: SentryOptions, pending: ErrorReport[] = []): () => void {
  init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    // O SDK reescreveria a mensagem do erro de rede em tempo de execução
    // ("Failed to fetch (host)"); o app lê essa mensagem. Só no relatório.
    enhanceFetchErrorMessages: "report-only",
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: options.replayOnErrorRate,
    ignoreErrors: IGNORED_ERRORS,
    denyUrls: EXTENSION_URLS,
    initialScope: { tags: { app: "torque-web" } },
    beforeSend: prepareEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });

  const detach = addErrorReporter(sentryReporter);
  for (const report of pending) sentryReporter(report);

  if (options.replayOnErrorRate > 0) {
    whenIdle(() => {
      void startReplay().catch(() => {
        // Sem gravação o relatório continua completo; não há o que avisar.
      });
    });
  }

  return detach;
}
