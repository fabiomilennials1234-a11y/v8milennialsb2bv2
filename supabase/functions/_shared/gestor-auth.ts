/**
 * Gestor de Portfólio — reconhecimento no server-side (ADR-0021 §6).
 *
 * O Gestor é um "scoped master": um ator FORA de `team_members` com escrita
 * full de admin operacional nas orgs vinculadas. Edge functions que autorizam
 * resolvendo `user → team_member` negariam o Gestor (ele não tem team_member
 * real). Este módulo é o ponto único que ensina o choke point compartilhado
 * (`permission_engine.ts`, `user-auth.ts`) a reconhecer o Gestor como `admin`
 * da org vinculada.
 *
 * Carve-outs (ADR-0021 §3): o Gestor NÃO gerencia o roster de admins/membros
 * do cliente (`team.*_member`, `team.manage_permissions`) nem billing/plano.
 * Essas ações mantêm o gate original — ver GESTOR_DENIED_* abaixo.
 *
 * Segurança: fail-closed. Qualquer erro de consulta → trata como NÃO-gestor
 * (nega). Nunca abre acesso por falha de infraestrutura.
 */

/**
 * Resultado de consulta, com `data` em `unknown`.
 *
 * `unknown` não é preguiça: é a única forma honesta de descrever o retorno aqui.
 * Como `select()` recebe uma `string` (não um literal), o parser de tipos do
 * postgrest-js não consegue derivar a linha e devolve `GenericStringError` —
 * diferente entre versões da lib, e este módulo é compartilhado por funções que
 * importam `@2` e `@2.49.4`. Prometer uma forma concreta faria a atribuição
 * falhar em uma das duas. `rowId`, abaixo, estreita o valor à mão.
 */
interface GestorAuthResult {
  data: unknown;
  error: { message: string } | null;
}

/** Encadeamento de filtro que este módulo usa, e nada além dele. */
interface GestorAuthFilter extends PromiseLike<GestorAuthResult> {
  eq: (column: string, value: unknown) => GestorAuthFilter;
  limit: (count: number) => GestorAuthFilter;
  maybeSingle: () => PromiseLike<GestorAuthResult>;
}

interface GestorAuthTable {
  select: (columns: string) => GestorAuthFilter;
}

/**
 * Client mínimo estrutural. Aceita qualquer SupabaseClient (service_role),
 * independente da versão de `@supabase/supabase-js` importada pela função
 * chamadora — o choke point (`@2`) e funções como carteira-bulk-message
 * (`@2.49.4`) compartilham este helper sem fricção de tipo entre versões.
 *
 * `from` devolve `unknown` DE PROPÓSITO. Descrever aqui o encadeamento
 * (`from(...).select(...)`) obrigava o compilador, a cada chamada, a instanciar
 * o `select` do supabase-js com `Query = string`; o parser de tipos da lib
 * recorre sobre a string de colunas e, num programa grande, estourava o
 * orçamento de instanciação — `TS2589` em `user-auth.ts`, e só quando a árvore
 * inteira era checada de uma vez (arquivo isolado passava, o que é o pior tipo
 * de erro: some quando você vai olhar). Com `unknown`, a comparação é trivial e
 * o estreitamento acontece num ponto só, em `queryTable`.
 */
interface GestorAuthClient {
  from: (table: string) => unknown;
}

/**
 * Único ponto onde o builder do supabase-js é estreitado.
 *
 * A asserção é inevitável — é a ponte entre um client de versão desconhecida e o
 * encadeamento mínimo que este módulo usa — mas é UMA, nomeada e comentada, em
 * vez de `any` vazando por todas as consultas. Se a lib mudar o encadeamento, o
 * conserto é aqui.
 */
function queryTable(supabase: GestorAuthClient, table: string, columns: string): GestorAuthFilter {
  return (supabase.from(table) as GestorAuthTable).select(columns);
}

/** `data` de uma linha lida por este módulo → `id` como string, ou null. */
function rowId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Ações de permissão (PermissionAction) que o Gestor NÃO herda como admin.
 * Roster/estrutura da org do cliente = carve-out. Operação = liberado.
 */
export const GESTOR_DENIED_ACTIONS: ReadonlySet<string> = new Set([
  "manage_team", // gerenciar admins/membros e permissões do cliente
]);

/**
 * Feature keys de roster/billing que o Gestor NÃO herda como admin.
 * Prefix-match: qualquer key que comece por um destes é negada ao Gestor.
 */
export const GESTOR_DENIED_FEATURE_PREFIXES: readonly string[] = [
  "team.",    // team.view, team.create_member, team.delete_member,
              // team.edit_member, team.manage_permissions
  "billing.", // billing/plano do cliente
];

/**
 * Retorna true se `featureKey` cai num carve-out (roster/billing) do Gestor.
 */
export function isGestorDeniedFeature(featureKey: string): boolean {
  return GESTOR_DENIED_FEATURE_PREFIXES.some((p) => featureKey.startsWith(p));
}

/**
 * Contexto do Gestor resolvido para uma org: o `gestores.id` REAL do ator.
 * ADR-0021 §7: este id é o que atribui a escrita cross-org ao ator real na
 * trilha forense (`runtime_logs.gestor_id`), nunca o virtual member.
 */
export interface GestorContext {
  /** `gestores.id` — id real do gestor (não o `gestor-virtual-<userId>` da UI). */
  gestorId: string;
}

/**
 * Resolve o Gestor ATIVO vinculado à org `organizationId`, retornando o
 * `gestores.id` real (ou `null` se não for gestor vinculado).
 *
 * Fonte única da checagem gestor → org. `isActiveGestorForOrg` delega aqui;
 * callers que precisam ATRIBUIR a escrita ao ator real (ADR-0021 §7) usam esta
 * variante para obter o `gestorId`.
 *
 * Consulta `gestores` (is_active) ⋈ `gestor_organizations` (org vinculada).
 * Usa o client service_role fornecido (bypassa RLS de propósito — o choke
 * point autoriza à mão). Fail-closed: erro ou dado ausente → null.
 *
 * @param supabase client service_role (por request, nunca singleton)
 * @param userId   auth.users.id do chamador
 * @param organizationId org-alvo da ação
 */
export async function getActiveGestorForOrg(
  supabase: GestorAuthClient,
  userId: string,
  organizationId: string,
): Promise<GestorContext | null> {
  if (!userId || !organizationId) return null;

  try {
    // 1. Gestor ativo do usuário (fora de team_members; espelha master_users).
    const { data: gestor, error: gestorErr } = await queryTable(supabase, "gestores", "id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    const gestorId = rowId(gestor);
    if (gestorErr || !gestorId) {
      if (gestorErr) {
        console.error(
          JSON.stringify({
            event: "gestor_auth.gestor_lookup_failed",
            user_id: userId,
            organization_id: organizationId,
            error: gestorErr.message,
          }),
        );
      }
      return null;
    }

    // 2. Vínculo org-alvo (binding master-gerido).
    const { data: binding, error: bindErr } = await queryTable(supabase, "gestor_organizations", "id")
      .eq("gestor_id", gestorId)
      .eq("organization_id", organizationId)
      .limit(1)
      .maybeSingle();

    if (bindErr) {
      // Fail-closed: qualquer erro de consulta nega o acesso.
      console.error(
        JSON.stringify({
          event: "gestor_auth.binding_lookup_failed",
          user_id: userId,
          organization_id: organizationId,
          error: bindErr.message,
        }),
      );
      return null;
    }

    return binding ? { gestorId } : null;
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "gestor_auth.check_threw",
        user_id: userId,
        organization_id: organizationId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

/**
 * Verifica se `userId` é um Gestor ATIVO vinculado à org `organizationId`.
 * Fina camada booleana sobre `getActiveGestorForOrg` — para call sites que só
 * precisam autorizar (não atribuir). Fail-closed: erro/ausência → false.
 */
export async function isActiveGestorForOrg(
  supabase: GestorAuthClient,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  return (await getActiveGestorForOrg(supabase, userId, organizationId)) !== null;
}

/**
 * Campos de `logRuntime` que atribuem uma escrita de gestor ao ATOR REAL
 * (ADR-0021 §7). Spread direto no `logRuntime`:
 *
 *   await logRuntime({ ...gestorRuntimeActor(userId, gestorId), module, action, ... });
 *
 * `triggeredBy` = auth.users.id real; `gestorId` = gestores.id real; nunca o
 * virtual member (`gestor-virtual-<userId>`), que é UI-only e não persistido.
 */
export function gestorRuntimeActor(
  userId: string,
  gestorId: string,
): { actorType: "gestor"; gestorId: string; triggeredBy: string } {
  return { actorType: "gestor", gestorId, triggeredBy: userId };
}
