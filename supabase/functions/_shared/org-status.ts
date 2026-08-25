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
 * `args` é OPCIONAL porque a assinatura do SDK também é (`rpc(fn, args?)`), e
 * uma superfície mínima não deve exigir mais do que quem a satisfaz oferece.
 *
 * ⚠️ Nota de método, porque quase virou uma afirmação errada aqui: um probe em
 * `tsc` contra o pacote **npm** `@supabase/supabase-js@2.105.4` diz que com
 * `args` OBRIGATÓRIO o client concreto não seria atribuível (`Args` colapsa em
 * `never`, e `Record<string, unknown>` não vai para `undefined`). Sob a
 * toolchain que estas funções REALMENTE usam — `deno check` resolvendo pelo
 * `esm.sh` do `deno.lock:20` — isso **não** se reproduz: com `args` obrigatório
 * o `deno check` de `agent-message` e `whatsapp-api-proxy` dá exatamente os
 * mesmos 31 e 1 erros (todos pré-existentes) e nenhum cita esta interface.
 *
 * A lição não é sobre `args`, é sobre onde medir: **npm e esm.sh resolvem tipos
 * de forma diferente, e só o `deno check` da própria função prova alguma coisa.**
 * Cuidado dobrado porque nenhum portão do CI cobre os importadores — o
 * `deno check` do CI é escopado a `_shared/` e não arrasta quem importa, e o
 * `typecheck:ratchet` só olha `src/`. Ver `_shared/auth.ts:202-205`, que
 * documenta outra armadilha de versão no mesmo SDK.
 */
export interface OrgStatusClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: unknown }>;
}

/**
 * Mensagem de um erro cru do `catch`. Espelho EXATO de `String(err?.message ?? err)`,
 * que é o que estava aqui antes de o `any` sair — só que sem `any`.
 *
 * 🚨 A forma importa, e eu já errei duas vezes tentando "melhorar" isto.
 * Um estreitamento por ramos (`if (err instanceof Error) return err.message; …`)
 * PARECE equivalente e não é: o `??` do original recua para o **erro inteiro**
 * quando `message` é nullish, e `String(<Error>)` chama
 * `Error.prototype.toString()`. Medido, 3 divergências:
 *
 *   Error com message=undefined   antes "Error"           ramos "undefined"
 *   Error com message=null        antes "Error: null"     ramos "null"
 *   função com .message           antes "boom-fn"         ramos "function alvo() {}"
 *                                 (função é `typeof "function"`, não `"object"`)
 *
 * Nenhuma é alcançável via supabase-js, e nenhuma muda o retorno do portão —
 * o `catch` devolve `false` de qualquer jeito. Mas isto alimenta o log de um
 * catch FAIL-OPEN num portão de billing, e "equivalente" ou é medido ou não é
 * afirmado. Se for mexer aqui, rode um diferencial das duas expressões sobre
 * Error/objeto/função/primitivo/nulo antes de trocar.
 *
 * O cast é estreito e honesto — descreve o que a leitura de `.message` já faz
 * em runtime, e não é `any`.
 */
function errorMessage(err: unknown): string {
  const message = err == null ? undefined : (err as { message?: unknown }).message;
  return String(message ?? err);
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
