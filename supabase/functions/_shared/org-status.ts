/**
 * org-status — a org está bloqueada por assinatura?
 *
 * O backend roda como `service_role`, que bypassa RLS. Ou seja: o gate de banco
 * (`get_my_organization_ids()` sem orgs bloqueadas) não alcança edge function
 * nenhuma. Sem este módulo, uma org suspensa continuaria com o motor ligado —
 * automação disparando, Copilot respondendo, WhatsApp saindo, custo correndo.
 *
 * A regra NÃO é reimplementada aqui: chamamos a RPC `org_access_blocked()`,
 * a mesma que as policies usam. Se a regra mudar, muda num lugar só.
 *
 * Fail-open por decisão: isto é um gate de cobrança, não uma fronteira de
 * segurança. Um erro de banco não pode calar o WhatsApp de 100 orgs pagantes.
 * A falha vai para `runtime_logs` com nível error.
 */

import { logRuntime } from "./logger.ts";

const TTL_MS = 60_000;

type CacheEntry = { blocked: boolean; at: number };
const cache = new Map<string, CacheEntry>();

/**
 * O mínimo que este módulo usa do client: uma RPC.
 *
 * Estrutural de propósito — os cinco call-sites passam clients de tipos
 * diferentes (`GovernorSupabaseClient`, o client cru do supabase-js, os fakes
 * dos testes) e nenhum deles precisa concordar num tipo nominal para chamar uma
 * função de banco. `data`/`error` ficam opcionais porque é assim que os fakes
 * respondem — o client real, que sempre devolve os dois, continua atribuível.
 *
 * `PromiseLike`, não `Promise`: o `rpc()` do supabase-js devolve um
 * `PostgrestFilterBuilder`, que é thenable mas não tem `catch`/`finally`. Exigir
 * `Promise` aqui rejeita o client real — e o `await` lá embaixo só precisa do
 * `then`.
 */
type ClienteComRpc = {
  rpc(
    fn: string,
    params?: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: unknown }>;
};

/**
 * Mensagem legível de um erro capturado.
 *
 * Trata o caso que importa aqui e não é `Error`: o erro do PostgREST chega como
 * objeto simples (`{ message, details, hint, code }`), então um
 * `err instanceof Error` sozinho o reduziria a "[object Object]" e apagaria a
 * única pista útil no `runtime_logs` — justo no caminho fail-open, onde o log é
 * tudo o que sobra.
 */
function mensagemDoErro(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Só para testes — zera o cache do módulo. */
export function __resetOrgStatusCache(): void {
  cache.clear();
}

/**
 * true quando a org está suspensa/cancelada/expirada SEM billing_override.
 * Resultado cacheado por 60s por instância da edge function.
 */
export async function isOrgBlocked(
  supabase: ClienteComRpc,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!organizationId) return false;

  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.blocked;

  try {
    const { data, error } = await supabase.rpc("org_access_blocked", {
      p_org_id: organizationId,
    });
    if (error) throw error;

    const blocked = data === true;
    cache.set(organizationId, { blocked, at: Date.now() });
    return blocked;
  } catch (err) {
    // fail-open: não derruba org pagante por causa de um blip de banco
    await logRuntime({
      organizationId,
      module: "billing",
      action: "org_access_blocked_check_failed",
      status: "error",
      errorMessage: mensagemDoErro(err),
    }).catch(() => {});
    return false;
  }
}

/**
 * Guarda para pontos de gasto (envio de WhatsApp, turno de IA).
 * Lança quando a org está bloqueada — quem chama decide se aborta ou registra.
 */
export class OrgBlockedError extends Error {
  readonly organizationId: string;
  constructor(organizationId: string) {
    super(`Organização ${organizationId} está com a assinatura bloqueada`);
    this.name = "OrgBlockedError";
    this.organizationId = organizationId;
  }
}

export async function assertOrgNotBlocked(
  supabase: ClienteComRpc,
  organizationId: string | null | undefined,
): Promise<void> {
  if (await isOrgBlocked(supabase, organizationId)) {
    throw new OrgBlockedError(String(organizationId));
  }
}
