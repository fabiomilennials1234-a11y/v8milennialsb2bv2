/**
 * Recuperação de build velho — um único caminho para sair de um frontend preso
 * numa versão que o servidor já não tem.
 *
 * Depois de um deploy, uma aba (ou o service worker dela) ainda aponta para
 * chunks hashados do build anterior; o nginx devolve 404 e o `import()` da rota
 * falha. Reload puro não basta: o SW antigo serve o mesmo `index.html` do
 * precache e a aba reentra no mesmo erro. Por isso a recuperação desregistra o
 * SW e apaga os caches ANTES de recarregar.
 *
 * Antes havia três caminhos que competiam: `main.tsx` recarregava sem limpar o
 * SW e marcava uma flag de sessão que nunca expirava (a aba só se recuperava da
 * primeira falha, para sempre); a `GlobalErrorBoundary` fazia a limpeza certa;
 * `lazyRetry` re-tentava um `import()` que o browser já memorizou como falho.
 * Chamado 39ff2cd1 (SORVFOODS, 2026-10-01): um usuário ficou preso por ~45 min.
 *
 * O throttle é um TIMESTAMP, não uma flag: dentro da janela não há loop de
 * reload; passada a janela, uma nova falha na mesma aba se recupera de novo.
 */

export const RECOVERY_KEY = "v8:stale-build-recovery-at";
export const RECOVERY_THROTTLE_MS = 10_000;

const STALE_CHUNK_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Loading (CSS )?chunk \S+ failed/i,
  /ChunkLoadError/i,
  // Rota de SPA devolvendo index.html no lugar do .js de um chunk que sumiu.
  /Unexpected token '<'/i,
  /Invalid or unexpected token/i,
  /expected expression, got '<'/i,
];

export function isStaleChunkError(reason: unknown): boolean {
  if (reason instanceof Error && reason.name === "ChunkLoadError") return true;
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return !!message && STALE_CHUNK_PATTERNS.some((re) => re.test(message));
}

/** O que a recuperação toca no browser — injetável para teste. */
export interface RecoveryEnv {
  now: () => number;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  serviceWorker?: {
    getRegistrations: () => Promise<ReadonlyArray<{ unregister: () => Promise<boolean> }>>;
  };
  caches?: { keys: () => Promise<string[]>; delete: (key: string) => Promise<boolean> };
  reload: () => void;
}

export function browserEnv(): RecoveryEnv {
  let storage: RecoveryEnv["storage"] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Storage bloqueado (política do navegador): segue sem throttle persistido.
  }
  return {
    now: () => Date.now(),
    storage,
    serviceWorker: typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
    caches: typeof caches !== "undefined" ? caches : undefined,
    reload: () => window.location.reload(),
  };
}

function readLast(env: RecoveryEnv): number | null {
  try {
    const raw = env.storage?.getItem(RECOVERY_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLast(env: RecoveryEnv, at: number) {
  try {
    env.storage?.setItem(RECOVERY_KEY, String(at));
  } catch {
    // Sem storage não há throttle entre reloads; a janela some com a aba.
  }
}

/**
 * Desregistra o SW, apaga os caches e recarrega. Devolve `false` quando a última
 * recuperação desta aba foi há menos de `RECOVERY_THROTTLE_MS` — o chamador
 * então mostra a tela de "versão nova" em vez de recarregar em loop.
 * `force` é o clique do usuário: ele já viu a tela, então recarrega sempre.
 */
export async function recoverFromStaleBuild(
  env: RecoveryEnv = browserEnv(),
  { force = false }: { force?: boolean } = {},
): Promise<boolean> {
  const now = env.now();
  const last = readLast(env);
  if (!force && last !== null && now - last < RECOVERY_THROTTLE_MS) return false;
  writeLast(env, now);

  try {
    const regs = (await env.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if (env.caches) {
      const keys = await env.caches.keys();
      await Promise.all(keys.map((k) => env.caches!.delete(k)));
    }
  } catch {
    // Best-effort: a limpeza falhar não pode impedir o reload.
  }
  env.reload();
  return true;
}

/** Handler global (`error` / `unhandledrejection`): só age em chunk velho. */
export function handleStaleChunk(reason: unknown, env?: RecoveryEnv): void {
  if (isStaleChunkError(reason)) void recoverFromStaleBuild(env);
}

/**
 * `import()` de rota com uma nova tentativa para falha de rede passageira. Se o
 * erro persiste e é de chunk velho, re-tentar o mesmo módulo é inútil (o browser
 * memoriza o import falho): aciona a recuperação e repassa o erro para a
 * `GlobalErrorBoundary` mostrar a tela de versão nova enquanto o reload acontece.
 */
export function lazyRetry<T>(
  importFn: () => Promise<T>,
  { retries = 1, delayMs = 1000, env }: { retries?: number; delayMs?: number; env?: RecoveryEnv } = {},
): Promise<T> {
  return importFn().catch((err: unknown) => {
    if (retries > 0) {
      return new Promise<T>((resolve, reject) =>
        setTimeout(
          () => lazyRetry(importFn, { retries: retries - 1, delayMs, env }).then(resolve, reject),
          delayMs,
        ),
      );
    }
    handleStaleChunk(err, env);
    throw err;
  });
}
