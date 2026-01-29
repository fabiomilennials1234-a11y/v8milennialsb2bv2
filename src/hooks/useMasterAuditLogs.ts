/**
 * Hook para leitura dos logs de auditoria do Master
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AuditLog {
  id: string;
  master_user_id: string;
  user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  target_name: string | null;
  details: Record<string, any> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  // Joined
  master_user?: {
    user_id: string;
    notes: string | null;
  };
}

export interface AuditLogFilters {
  action?: string;
  targetType?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

/**
 * Lista logs de auditoria com filtros
 */
export function useMasterAuditLogs(filters: AuditLogFilters = {}) {
  return useQuery({
    queryKey: ["master-audit-logs", filters],
    queryFn: async (): Promise<AuditLog[]> => {
      let query = supabase
        .from("master_audit_logs")
        .select(`
          *,
          master_user:master_users(user_id, notes)
        `)
        .order("created_at", { ascending: false });

      if (filters.action) {
        query = query.eq("action", filters.action);
      }

      if (filters.targetType) {
        query = query.eq("target_type", filters.targetType);
      }

      if (filters.startDate) {
        query = query.gte("created_at", filters.startDate);
      }

      if (filters.endDate) {
        query = query.lte("created_at", filters.endDate);
      }

      if (filters.limit) {
        query = query.limit(filters.limit);
      } else {
        query = query.limit(100);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as AuditLog[];
    },
    staleTime: 10 * 1000, // 10 segundos
  });
}

/**
 * Ações únicas para filtro
 */
export function useMasterAuditActions() {
  return useQuery({
    queryKey: ["master-audit-actions"],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("master_audit_logs")
        .select("action")
        .limit(1000);

      if (error) throw error;

      const actions = [...new Set(data?.map((d) => d.action) || [])];
      return actions.sort();
    },
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
}

/**
 * Estatísticas de auditoria
 */
export function useMasterAuditStats() {
  return useQuery({
    queryKey: ["master-audit-stats"],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);

      const { data: allLogs, error: allError } = await supabase
        .from("master_audit_logs")
        .select("action, created_at")
        .gte("created_at", weekAgo.toISOString());

      if (allError) throw allError;

      const logs = allLogs || [];
      const todayLogs = logs.filter(
        (l) => new Date(l.created_at) >= today
      );

      // Contagem por ação
      const actionCounts: Record<string, number> = {};
      logs.forEach((l) => {
        actionCounts[l.action] = (actionCounts[l.action] || 0) + 1;
      });

      return {
        totalWeek: logs.length,
        totalToday: todayLogs.length,
        byAction: actionCounts,
      };
    },
    staleTime: 30 * 1000,
  });
}
