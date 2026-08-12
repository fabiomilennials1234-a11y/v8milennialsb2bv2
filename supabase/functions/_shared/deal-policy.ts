/**
 * "Negócio nasce só por clique humano" — a flag por org, lida de dentro de uma
 * Edge Function.
 *
 * ADR-0023 decisão 3: nenhum caminho de ingest, integração ou automação cria um
 * Negócio. A flag que liga isso por organização é
 * `organizations.feature_flags -> 'deal_manual_only'`.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 * A migration `20270730000040_auto_seed_deal_manual_only.sql` gateou o trigger
 * `fn_auto_assign_lead_default_pipe`, e o comentário que ela deixou na própria
 * função (linhas 373-379) já dizia o que ficou faltando:
 *
 *   "⚠️ Gatear esta função NÃO impede a criação automática de card na ingestão:
 *    lead-service (getOrCreateLead) e lead-webhook semeiam whatsapp/novo em
 *    código de edge function, sem ler feature_flags — com a flag ON eles deixam
 *    de encontrar a entry e passam a criá-la, efeito líquido zero nesses
 *    caminhos."
 *
 * Ou seja: o gate do banco só morde onde o código NÃO chega primeiro. Este
 * módulo é o outro lado.
 *
 * ── NÃO CONFUNDIR COM `_shared/feature-flags.ts` ───────────────────────────
 * São DOIS sistemas homônimos neste projeto, e escolher o errado é um bug mudo:
 *
 *   - `_shared/feature-flags.ts` → cascata `organization_features` (override com
 *     expiry) → tabela global `feature_flags`. Fail-CLOSED.
 *   - este arquivo → coluna jsonb `organizations.feature_flags`. É onde
 *     `deal_manual_only` vive, e onde a migration 20270730000040:289 a lê.
 *
 * O comentário canônico da coluna (baseline:25853) fecha a questão: "Keys
 * snake_case, valores boolean. Estritamente `true` ativa (hook useFeatureFlag).
 * Independente do par feature_flags/organization_features".
 *
 * ── COMPARAÇÃO ESTRITA, NÃO `Boolean(...)` ────────────────────────────────
 * `=== true` espelha exatamente o `= 'true'::jsonb` da migration e o `=== true`
 * de `src/modules/platform/hooks/useFeatureFlag.ts:51`. Um `Boolean(v)` faria a
 * string `"false"` ligar a flag; um `JSON.parse` levantaria em `{"…": "sim"}`.
 * Três leitores da mesma flag têm de concordar sobre o que "ligada" significa.
 *
 * ── FAIL-OPEN, e a razão é a mesma da migration ───────────────────────────
 * Erro de leitura → `false` → o caminho segue criando o Negócio como sempre
 * criou. É a MESMA escolha do bloco (F) da migration ("uma flag de rollout
 * jamais deve ser o motivo de um lead não entrar na base"), e aqui ela pesa
 * ainda mais: a flag está ON em pouquíssimas orgs, então fail-closed
 * transformaria um soluço de rede em "ninguém entra em funil nenhum" para a
 * base inteira. Manter as duas pontas com a mesma filosofia também importa —
 * um revisor comparando gate do banco com gate do código não deve encontrar
 * dois critérios.
 *
 * ── CACHE ─────────────────────────────────────────────────────────────────
 * TTL de 30s por org, espelhando `_shared/feature-flags.ts` e
 * `_shared/message-gateway.ts`. O caminho quente é o turn do Copilot e o
 * webhook de ingest: sem cache, um lote de import faria uma query por linha.
 * 30s é curto o bastante para que ligar/desligar a flag apareça dentro de uma
 * janela operacional aceitável, e o cache é por instância de edge function —
 * não sobrevive a um cold start.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEAL_POLICY_CACHE_TTL_MS = 30_000;

const dealPolicyCache = new Map<string, { manualOnly: boolean; expiresAt: number }>();

/**
 * `true` quando a org declarou que Negócio nasce só por clique humano.
 *
 * Fail-open: qualquer erro de leitura devolve `false`.
 */
export async function isDealManualOnly(
  supabase: SupabaseClient,
  organizationId: string | null | undefined,
): Promise<boolean> {
  // Sem org não há política a aplicar. Devolver `true` aqui bloquearia escrita
  // por falta de contexto, que é falha silenciosa disfarçada de política.
  if (!organizationId) return false;

  const now = Date.now();
  const cached = dealPolicyCache.get(organizationId);
  if (cached && cached.expiresAt > now) return cached.manualOnly;

  let manualOnly = false;
  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("feature_flags")
      .eq("id", organizationId)
      .maybeSingle();

    if (error) {
      console.warn(
        `[deal-policy] leitura de organizations.feature_flags falhou para org=${organizationId}; seguindo como deal_manual_only=false (fail-open):`,
        error.message,
      );
      // Não cacheia falha: o próximo caminho tenta de novo em vez de ficar
      // 30s decidindo por um erro transitório.
      return false;
    }

    if (!data) {
      // Linha não veio. Duas causas, e as duas precisam ser BARULHENTAS:
      //   - org inexistente (não deveria: as tabelas de origem têm FK);
      //   - o client não é service_role e a RLS de `organizations` escondeu a
      //     linha do papel que está lendo.
      //
      // O segundo caso é o modo de falha que a migration 20270730000040 chamou,
      // no próprio corpo, de "o pior tipo": a flag some, o caminho cai em false
      // e a política da org é ignorada sem nada na tela denunciando. Aqui ele
      // continua sendo fail-open — mas deixa rastro em `runtime_logs`/console
      // em vez de passar batido.
      console.warn(
        `[deal-policy] organizations não devolveu linha para org=${organizationId}. Seguindo como deal_manual_only=false. Se este caminho não usa service_role, a RLS pode estar escondendo a linha — e então a flag está sendo ignorada em silêncio.`,
      );
      return false;
    }

    const flags = (data.feature_flags ?? {}) as Record<string, unknown>;
    manualOnly = flags.deal_manual_only === true;
  } catch (err) {
    console.warn(
      `[deal-policy] exceção ao ler feature_flags para org=${organizationId}; seguindo como deal_manual_only=false (fail-open):`,
      (err as Error)?.message,
    );
    return false;
  }

  dealPolicyCache.set(organizationId, {
    manualOnly,
    expiresAt: now + DEAL_POLICY_CACHE_TTL_MS,
  });
  return manualOnly;
}

/** Só para teste — zera o cache entre casos. */
export function __resetDealPolicyCache(): void {
  dealPolicyCache.clear();
}
