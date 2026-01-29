/**
 * Sistema de Validação de Subscription/Pagamento
 * 
 * Verifica se a organização tem subscription ativa antes de permitir acesso
 */

import { supabase } from '@/integrations/supabase/client';

export interface SubscriptionStatus {
  status: 'trial' | 'active' | 'suspended' | 'cancelled' | 'expired';
  plan: string | null;
  expiresAt: string | null;
  isValid: boolean;
  daysRemaining: number | null;
}

/**
 * Verifica o status da subscription de uma organização
 */
export async function checkSubscription(
  organizationId: string
): Promise<SubscriptionStatus> {
  const { data: org, error } = await supabase
    .from('organizations')
    .select('subscription_status, subscription_plan, subscription_expires_at')
    .eq('id', organizationId)
    .single();

  if (error || !org) {
    return {
      status: 'expired',
      plan: null,
      expiresAt: null,
      isValid: false,
      daysRemaining: null,
    };
  }

  const now = new Date();
  const expiresAt = org.subscription_expires_at 
    ? new Date(org.subscription_expires_at) 
    : null;

  let isValid = false;
  let daysRemaining: number | null = null;

  switch (org.subscription_status) {
    case 'active':
      if (!expiresAt || expiresAt > now) {
        isValid = true;
        if (expiresAt) {
          daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }
      } else {
        // Subscription expirada mas status ainda é 'active'
        isValid = false;
        daysRemaining = 0;
      }
      break;
    
    case 'trial':
      if (!expiresAt || expiresAt > now) {
        isValid = true;
        if (expiresAt) {
          daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }
      } else {
        isValid = false;
        daysRemaining = 0;
      }
      break;
    
    case 'suspended':
    case 'cancelled':
    case 'expired':
    default:
      isValid = false;
      if (expiresAt) {
        const diff = now.getTime() - expiresAt.getTime();
        daysRemaining = diff > 0 ? -Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
      }
      break;
  }

  return {
    status: org.subscription_status,
    plan: org.subscription_plan,
    expiresAt: org.subscription_expires_at,
    isValid,
    daysRemaining,
  };
}

/**
 * Verifica se o usuário atual tem subscription válida
 */
export async function checkCurrentUserSubscription(): Promise<SubscriptionStatus | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Buscar organização do usuário
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single();

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
    .single();

  if (!teamMember?.organization_id) {
    return null;
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', teamMember.organization_id)
    .single();

  return org;
}
