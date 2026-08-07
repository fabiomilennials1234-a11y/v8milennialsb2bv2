/**
 * Laço de exclusão de instância de WhatsApp.
 *
 * A exclusão não cabe numa chamada só: o cascade `ON DELETE SET NULL` de
 * `whatsapp_messages` custa 22,7s de média e 53,4s de pico no PROD
 * (pg_stat_statements — 4,4 GB, 18 índices, 7 deles com `instance_id`), contra
 * os 8s de `statement_timeout` do PostgREST. A RPC
 * `whatsapp_instance_delete_step` faz UM lote por chamada e devolve progresso;
 * este módulo é só o laço em volta dela — separado do edge function para poder
 * ser testado sem Deno nem Supabase.
 */

export type DeleteStepPhase =
  | "messages"
  | "media_jobs"
  | "health_checks"
  | "conversation_summary"
  | "deleted"
  | "already_gone";

/** Retorno de `whatsapp_instance_delete_step`. */
export type DeleteStepProgress = {
  done: boolean;
  phase: DeleteStepPhase;
  touched?: number;
  remaining?: number;
};

export type DeleteStepCall = {
  data: unknown;
  error: { message: string } | null;
};

export type DeleteRunResult =
  | { status: "done"; steps: number; progress: DeleteStepProgress | null }
  | { status: "pending"; steps: number; progress: DeleteStepProgress | null }
  | { status: "error"; steps: number; message: string };

/**
 * Lote por chamada.
 *
 * Dimensionado para caber nos **8s** do `authenticator`, não nos 55s que a RPC
 * pede via `set_config`: o Postgres arma o timer do `statement_timeout` quando
 * o statement começa, então mudar o GUC dentro da função NÃO re-agenda o timer
 * da chamada em curso. Medido no PROD (pg_stat_statements, variante por ctid):
 * 3.000 linhas de `whatsapp_messages` = 8,1s de média e 18,4s de pico. Em
 * 1.000 dá ≈2,7s de média e ≈6,1s de pico — dentro do teto com folga.
 */
export const DELETE_BATCH_SIZE = 1000;
/**
 * Teto de tempo antes de devolver progresso e pedir nova tentativa.
 *
 * Com lote de 1.000 uma instância de ~20k mensagens leva ~38 idas e voltas;
 * um teto curto demais faria o usuário clicar duas vezes à toa.
 */
export const DELETE_DEADLINE_MS = 110_000;
/** Trava contra laço infinito caso a RPC pare de progredir. */
export const DELETE_MAX_STEPS = 200;

/**
 * Chama `step` até a RPC dizer `done`, o relógio passar do deadline ou o teto
 * de passos estourar.
 *
 * `pending` NÃO é falha: a RPC é idempotente, então a próxima tentativa
 * continua de onde parou. Quem chama deve dizer isso ao usuário em vez de
 * mostrar erro.
 */
export async function runInstanceDeletion(opts: {
  /** PromiseLike, não Promise: o builder do supabase-js é thenable, não Promise. */
  step: () => PromiseLike<DeleteStepCall>;
  deadlineMs?: number;
  maxSteps?: number;
  now?: () => number;
  onStep?: (step: number, progress: DeleteStepProgress | null) => void;
}): Promise<DeleteRunResult> {
  const now = opts.now ?? (() => Date.now());
  const deadlineMs = opts.deadlineMs ?? DELETE_DEADLINE_MS;
  const maxSteps = opts.maxSteps ?? DELETE_MAX_STEPS;
  const deadlineAt = now() + deadlineMs;

  let steps = 0;
  let progress: DeleteStepProgress | null = null;

  while (true) {
    steps++;
    const { data, error } = await opts.step();

    if (error) {
      return { status: "error", steps, message: error.message };
    }

    progress = (data ?? null) as DeleteStepProgress | null;
    opts.onStep?.(steps, progress);

    if (progress?.done) {
      return { status: "done", steps, progress };
    }

    if (now() > deadlineAt || steps >= maxSteps) {
      return { status: "pending", steps, progress };
    }
  }
}
