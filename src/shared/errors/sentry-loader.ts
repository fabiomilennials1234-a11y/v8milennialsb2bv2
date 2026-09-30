import { addErrorReporter, type ErrorReport } from "./report";
import type { SentryOptions } from "./sentry";

/** Teto da fila de boot: um laço de erro não enche a memória antes do SDK chegar. */
const MAX_PENDING = 20;

interface SentryEnv {
  VITE_SENTRY_DSN?: string;
  VITE_SENTRY_ENVIRONMENT?: string;
  VITE_SENTRY_REPLAY_ON_ERROR_RATE?: string;
  PROD: boolean;
}

/** Fração em [0, 1]; ausente ou inválida → 1 (todo erro relatado leva a gravação). */
function rate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 1;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** `null` quando o build não tem DSN — e aí o SDK não carrega. */
export function sentryOptionsFromEnv(env: SentryEnv, release: string): SentryOptions | null {
  const dsn = env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return null;
  return {
    dsn,
    environment: env.VITE_SENTRY_ENVIRONMENT?.trim() || (env.PROD ? "production" : "development"),
    release,
    replayOnErrorRate: rate(env.VITE_SENTRY_REPLAY_ON_ERROR_RATE),
  };
}

/**
 * Carrega o SDK fora do caminho crítico e sem perder o boot.
 *
 * O SDK chega por import dinâmico — não pesa na primeira pintura. Mas o erro que
 * mais importa (a consulta do membro que falha, a assinatura que não responde)
 * acontece justamente enquanto ele carrega. Uma fila segura esses relatórios e
 * os entrega quando o SDK liga.
 *
 * Sem DSN, nada disto roda: quem chama (`main.tsx`) só chama com DSN.
 */
export function loadSentry(options: SentryOptions): Promise<() => void> {
  const pending: ErrorReport[] = [];
  const stopQueue = addErrorReporter((report) => {
    if (pending.length < MAX_PENDING) pending.push(report);
  });

  return import("./sentry")
    .then(({ initSentry }) => {
      stopQueue();
      return initSentry(options, pending);
    })
    .catch(() => {
      // Sem Sentry o app segue igual, e o anel do Chamado continua recebendo.
      stopQueue();
      return () => {};
    });
}
