/**
 * Hook for accessing current user's organization context
 * 
 * SECURITY: This hook provides the organization_id that should be used
 * to filter all data queries. Never bypass this filter.
 */

import { useCurrentTeamMember } from "./useTeamMembers";

export interface OrganizationContext {
  organizationId: string | null;
  teamMemberId: string | null;
  role: string | null;
  isLoading: boolean;
  isReady: boolean;
  error: Error | null;
}

/**
 * Returns the current user's organization context
 * Use this to get the organization_id for filtering queries
 */
export function useOrganization(): OrganizationContext {
  const { data: teamMember, isLoading, error } = useCurrentTeamMember();

  return {
    organizationId: teamMember?.organization_id ?? null,
    teamMemberId: teamMember?.id ?? null,
    role: teamMember?.role ?? null,
    isLoading,
    isReady: !isLoading && !!teamMember?.organization_id,
    error: error as Error | null,
  };
}

/**
 * Helper to ensure organization_id is present
 * Throws if organization is not available
 */
export function useRequiredOrganization(): Required<Pick<OrganizationContext, 'organizationId' | 'teamMemberId'>> & Omit<OrganizationContext, 'organizationId' | 'teamMemberId'> {
  const context = useOrganization();
  
  if (!context.isLoading && !context.organizationId) {
    throw new Error("Organization context is required but not available");
  }
  
  return context as Required<Pick<OrganizationContext, 'organizationId' | 'teamMemberId'>> & Omit<OrganizationContext, 'organizationId' | 'teamMemberId'>;
}
