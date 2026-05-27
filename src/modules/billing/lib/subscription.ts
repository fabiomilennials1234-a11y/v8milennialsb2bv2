/**
 * Sistema de Validação de Subscription/Pagamento
 * 
 * Verifica se a organização tem subscription ativa antes de permitir acesso
 */

import { supabase } from '@/integrations/supabase/client';

export interface SubscriptionStatus {
  status: 'trial' | 'active' | 'overdue' | 'suspended' | 'cancelled' | 'expired';
  plan: string | null;
  expiresAt: string | null;
  isValid: boolean;
  daysRemaining: number | null;
  graceRemaining: number | null;
  isOverdue: boolean;
  isBlocked: boolean;
}

/**
 * Verifica o status da subscription de uma organização
 * Delega para a RPC org_get_subscription_status que centraliza toda a lógica server-side
 */
export async function checkSubscription(
  organizationId: string
): Promise<SubscriptionStatus> {
  const { data, error } = await supabase.rpc("org_get_subscription_status", {
    p_org_id: organizationId,
  } as any);

  if (error || !data) {
    return {
      status: 'expired',
      plan: null,
      expiresAt: null,
      isValid: false,
      daysRemaining: null,
      graceRemaining: null,
      isOverdue: false,
      isBlocked: true,
    };
  }

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
