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

/**
 * Superfície mínima do client que este módulo usa: uma RPC, e o `{ data, error }`
 * que ela devolve. Estrutural de propósito — aceita tanto o `SupabaseClient`
 * concreto (agent-message, whatsapp-api-proxy) quanto o `GovernorSupabaseClient`
 * do send-governor, sem que org-status passe a depender do SDK nem do governor
 * (que é quem importa daqui, não o contrário).
 *
 * ⚠️ `args` é OPCIONAL, e isso não é frouxidão — é o que faz a interface ser
 * satisfeita pelo client de verdade. Medido contra a supabase-js **2.105.4**,
 * que é a que o `deno.lock:20` trava (o `node_modules` do repo tem a 2.89.0,
 * onde `Database = any` e QUALQUER interface passa trivialmente — provar por
 * ali não prova nada). Na 2.105.4 os defaults são `Database = unknown` /
 * `SchemaName = never`, então `Args` colapsa em `never` e a assinatura do SDK
 * vira `args?: undefined`. Com `args` obrigatório aqui, `tsc --strict` recusa:
 *
 *   Type 'SupabaseClient<unknown, …, never, never, …>' is not assignable
 *     to type 'OrgStatusClient'.
 *       Type 'Record<string, unknown>' is not assignable to type 'undefined'.
 *
 * E nenhum portão pegaria: `deno check` do CI é escopado a `_shared/` e não
 * arrasta os importadores (agent-message, whatsapp-api-proxy estão fora), e o
 * `typecheck:ratchet` só olha `src/`. O erro só apareceria no deploy.
 * Mesma armadilha de versão que `_shared/auth.ts:202-205` já documenta.
 */
export interface OrgStatusClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: unknown }>;
}

/**
 * Mensagem de um erro cru do `catch`. Cobre os dois formatos que chegam aqui:
 * `Error` lançado pelo runtime e o objeto `{ message }` do PostgrestError, que
 * é o que `if (error) throw error` propaga. Estreitamento real, sem cast — se
 * não houver mensagem, o valor inteiro vira string, como antes.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err && err.message != null) {
    return String(err.message);
  }
  return String(err);
}

type CacheEntry = { blocked: boolean; at: number };
const cache = new Map<string, CacheEntry>();

/** Só para testes — zera o cache do módulo. */
export function __resetOrgStatusCache(): void {
  cache.clear();
}

/**
 * true quando a org está suspensa/cancelada/expirada SEM billing_override.
 * Resultado cacheado por 60s por instância da edge function.
 */
export async function isOrgBlocked(
  supabase: OrgStatusClient,
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
      errorMessage: errorMessage(err),
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
  supabase: OrgStatusClient,
  organizationId: string | null | undefined,
): Promise<void> {
  if (await isOrgBlocked(supabase, organizationId)) {
    throw new OrgBlockedError(String(organizationId));
  }
}
