/**
 * Sistema de Validação de Subscription/Pagamento
 * 
 * Verifica se a organização tem subscription ativa antes de permitir acesso
 */

import { supabase } from '@/integrations/supabase/client';

export interface SubscriptionStatus {
  /**
   * `'unknown'` = não foi possível determinar o status (erro de transporte/RPC
   * indisponível). NÃO é um status terminal — o guard trata como fail-open.
   * Bloqueio real só nos terminais afirmados pelo DB (suspended/cancelled/expired).
   */
  status: 'trial' | 'active' | 'overdue' | 'suspended' | 'cancelled' | 'expired' | 'unknown';
  plan: string | null;
  expiresAt: string | null;
  isValid: boolean;
  daysRemaining: number | null;
  graceRemaining: number | null;
  isOverdue: boolean;
  isBlocked: boolean;
}

/**
 * Backoff entre tentativas da RPC (ms). Length = nº de retries; +1 é a tentativa
 * inicial. A RPC é STABLE/idempotente, então o retry só absorve timeout de transporte.
 */
const RPC_RETRY_DELAYS_MS = [150, 400];

/**
 * Estado fail-open: usado quando NÃO foi possível determinar o status (erro de
 * transporte / RPC indisponível). NÃO bloqueia o usuário.
 *
 * O guard de subscription é DISPLAY/UX — o enforcement real de plano/tenant é
 * server-side (RLS + RPCs SECURITY DEFINER). Bloquear um cliente pagante por um
 * timeout de rede é pior que liberar acesso momentâneo a um guard cosmético.
 * Bloqueio só acontece quando o DB AFIRMA um status terminal.
 */
function unknownSubscription(): SubscriptionStatus {
  return {
    status: 'unknown',
    plan: null,
    expiresAt: null,
    isValid: true,
    daysRemaining: null,
    graceRemaining: null,
    isOverdue: false,
    isBlocked: false,
  };
}

/**
 * Verifica o status da subscription de uma organização
 * Delega para a RPC org_get_subscription_status que centraliza toda a lógica server-side
 *
 * Em erro de transporte (timeout/rede), faz retry curto e, persistindo, devolve
 * estado `'unknown'` fail-open — NUNCA assume `'expired'`. Ver `unknownSubscription`.
 */
export async function checkSubscription(
  organizationId: string
): Promise<SubscriptionStatus> {
  for (let attempt = 0; attempt <= RPC_RETRY_DELAYS_MS.length; attempt++) {
    const { data, error } = await supabase.rpc("org_get_subscription_status", {
      p_org_id: organizationId,
    } as any);

    if (!error && data) {
      const result = data as Record<string, any>;
      return {
        status: result.status,
        plan: result.plan,
        expiresAt: result.expires_at,
        isValid: result.is_valid,
        daysRemaining: result.days_remaining,
        graceRemaining: result.grace_remaining ?? null,
        isOverdue: result.is_overdue ?? false,
        isBlocked: result.is_blocked ?? false,
      };
    }

    // Resposta anômala sem erro: a RPC sempre retorna jsonb quando executa (org
    // inexistente vem como data.status='expired'). data nulo sem erro = não dá
    // pra afirmar terminal → fail-open, sem retry (não é falha de transporte).
    if (!error && !data) {
      return unknownSubscription();
    }

    // error presente = falha de transporte (timeout/rede). Retry com backoff curto.
    const delay = RPC_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Esgotou os retries em erro de transporte → fail-open. Não bloqueia pagante.
  return unknownSubscription();
}

/**
 * Verifica se o usuário atual tem subscription válida
 */
export async function checkCurrentUserSubscription(): Promise<SubscriptionStatus | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Buscar organização do usuário (limit 1 pois masters podem estar em múltiplas orgs)
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!teamMember?.organization_id) {
    return null;
  }

  return checkSubscription(teamMember.organization_id);
}

/**
 * Obtém informações da organização do usuário atual
 */
export async function getCurrentOrganization() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: teamMember } = await supabase
    .from('team_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!teamMember?.organization_id) {
    return null;
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', teamMember.organization_id)
    .maybeSingle();

  return org;
}
