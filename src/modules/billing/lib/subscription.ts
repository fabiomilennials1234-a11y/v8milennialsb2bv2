/**
 * Sistema de Validação de Subscription/Pagamento
 * 
 * Verifica se a organização tem subscription ativa antes de permitir acesso
 */

import { queryOptions } from '@tanstack/react-query';
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

  // Falha de consulta NÃO é assinatura vencida. Antes daqui, qualquer erro da RPC
  // (rede, timeout) virava `expired` + `isBlocked` e um cliente pagante via
  // "assinatura bloqueada". Quem chama decide — e o guard mantém o acesso
  // fechado, mas diz a verdade: não deu para verificar (ADR-0038).
  if (error) throw error;

  if (!data) {
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
 * Status da assinatura de UMA org — a do vínculo atual (`useCurrentTeamMember`,
 * que já resolveu o org switcher). Mesmo motor de `checkSubscription`; o nome
 * deixa explícito no chamador que a org vem de fora, não de um `limit 1`.
 */
export const checkSubscriptionForOrg = checkSubscription;

/** Frescor do status: igual ao cache que o Copilot já usava. */
const SUBSCRIPTION_STALE_MS = 5 * 60 * 1000;

/**
 * Chave ÚNICA do status de assinatura por org. O guard de rota e o Copilot
 * leem a mesma entrada: uma RPC por org por carga, não duas.
 */
export const subscriptionStatusKey = (organizationId: string | null | undefined) =>
  ['subscription-status', organizationId ?? null] as const;

/**
 * Opções compartilhadas da consulta. `retry: false` de propósito: falha de
 * verificação vai direto para a tela honesta com "Tentar de novo" (ADR-0038),
 * em vez de segurar o loader durante o backoff.
 */
export function subscriptionStatusQueryOptions(organizationId: string | null | undefined) {
  return queryOptions({
    queryKey: subscriptionStatusKey(organizationId),
    queryFn: () => {
      if (!organizationId) throw new Error('subscription-status: organization_id ausente');
      return checkSubscriptionForOrg(organizationId);
    },
    enabled: !!organizationId,
    staleTime: SUBSCRIPTION_STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Verifica se o usuário atual tem subscription válida.
 *
 * @deprecated Prefira `subscriptionStatusQueryOptions(orgDoVinculoAtual)`.
 * Esta função pega o PRIMEIRO vínculo ativo (`limit 1`, sem ordem) — em
 * multi-org pode checar uma org diferente da selecionada. Sem chamadores no
 * app desde a Trilha A do boot (21/11); fica pela API pública do módulo.
 */
export async function checkCurrentUserSubscription(): Promise<SubscriptionStatus | null> {
  // Sessão local, não `getUser()`: aquele é uma ida ao servidor de auth só
  // para descobrir o id que o token já carrega. A RPC valida o JWT de novo.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return null;

  // Buscar organização do usuário (limit 1 pois masters podem estar em múltiplas orgs)
  const { data: teamMember, error } = await supabase
    .from('team_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  // Erro ≠ "sem organização": o `null` abaixo significa ausência de vínculo.
  if (error) throw error;

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
