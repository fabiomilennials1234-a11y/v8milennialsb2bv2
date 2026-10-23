/**
 * anon-fallback-guard — impede que o usuário logado vire "anônimo" sem aviso.
 *
 * O supabase-js monta o `Authorization` de toda chamada com
 * `session?.access_token ?? anonKey`. Se o access token venceu e a renovação
 * falha — qualquer falha, até um soluço de rede ou do Auth —, `getSession()`
 * devolve `session: null` SEM apagar a sessão do storage, e a chamada sai com a
 * chave anônima. O banco responde `42501 permission denied for table/function X`
 * em tudo, e o usuário, que continua "logado" na tela, vê a página inteira
 * quebrar com erro de permissão (TORQUE-WEB-D/E/F/G/H/J/13/14/15/16/17: um
 * usuário, ~15 consultas no mesmo segundo, em duas rajadas no mesmo dia; as
 * Edge Functions deram "JWT inválido ou expirado" na mesma sessão).
 *
 * Aqui, chamada ao PostgREST/Functions/Storage que sairia só com a chave anônima
 * enquanto EXISTE sessão persistida vira falha de rede ("Failed to fetch"):
 * `network.offline`, retentável, em vez de `permission.denied` mentiroso. A
 * próxima tentativa passa de novo por `getSession()`, que tenta renovar.
 *
 * Quem não tem sessão persistida (login, páginas públicas) passa intacto, e o
 * Auth (`/auth/v1/`) nunca é bloqueado — é por ele que a sessão se recupera.
 */

const GUARDED_PATH = /\/(rest|functions|storage)\/v1\//;

export interface AnonFallbackGuardOptions {
  anonKey: string;
  hasPersistedSession: () => boolean;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function authorizationOf(input: RequestInfo | URL, init?: RequestInit): string | null {
  if (init?.headers) return new Headers(init.headers).get("Authorization");
  if (typeof Request !== "undefined" && input instanceof Request) return input.headers.get("Authorization");
  return null;
}

export function createAnonFallbackGuard(
  baseFetch: typeof fetch,
  { anonKey, hasPersistedSession }: AnonFallbackGuardOptions,
): typeof fetch {
  if (!anonKey) return baseFetch;
  const anonBearer = `Bearer ${anonKey}`;

  return (input, init) => {
    if (
      GUARDED_PATH.test(urlOf(input)) &&
      authorizationOf(input, init) === anonBearer &&
      hasPersistedSession()
    ) {
      return Promise.reject(
        new TypeError("Failed to fetch: sessão indisponível (renovação do token falhou), tente novamente"),
      );
    }
    return baseFetch(input, init);
  };
}

/** Há sessão do Supabase Auth gravada neste navegador? (`sb-<ref>-auth-token`) */
export function hasPersistedSupabaseSession(storage: Pick<Storage, "length" | "key" | "getItem"> = localStorage): boolean {
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && /^sb-.+-auth-token$/.test(key) && storage.getItem(key)) return true;
    }
  } catch {
    // storage indisponível: sem como afirmar que há sessão, a chamada segue.
  }
  return false;
}
