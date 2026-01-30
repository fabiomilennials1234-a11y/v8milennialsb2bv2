/**
 * Hooks para gerenciamento de usuários pelo Master Admin
 *
 * Permite ao Master ver, criar e gerenciar TODOS os usuários do sistema.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface MasterUserView {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  // From profiles
  full_name: string | null;
  avatar_url: string | null;
  // From team_members
  team_member_id: string | null;
  organization_id: string | null;
  organization_name: string | null;
  role: string | null;
  is_active: boolean;
}

export interface UserStats {
  total: number;
  active: number;
  admins: number;
  sdrs: number;
  closers: number;
  withoutOrg: number;
}

/**
 * Lista todos os usuários com seus perfis e organizações
 */
export function useMasterUsers() {
  return useQuery({
    queryKey: ["master-users"],
    queryFn: async (): Promise<MasterUserView[]> => {
      // Buscar team_members com informações relacionadas
      const { data: members, error: membersError } = await supabase
        .from("team_members")
        .select(`
          id,
          user_id,
          name,
          role,
          is_active,
          organization_id,
          organization:organizations(id, name)
        `)
        .order("name");

      if (membersError) throw membersError;

      // Buscar profiles para informações adicionais
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url");

      if (profilesError) throw profilesError;

      // Mapear dados
      const profileMap = new Map(profiles?.map((p) => [p.id, p]));

      return (members || []).map((member) => ({
        id: member.user_id || member.id,
        email: "", // Não temos acesso direto ao email via RLS
        created_at: "",
        last_sign_in_at: null,
        full_name: member.name || profileMap.get(member.user_id)?.full_name || null,
        avatar_url: profileMap.get(member.user_id)?.avatar_url || null,
        team_member_id: member.id,
        organization_id: member.organization_id,
        organization_name: (member.organization as any)?.name || null,
        role: member.role,
        is_active: member.is_active,
      }));
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Estatísticas de usuários
 */
export function useMasterUserStats() {
  return useQuery({
    queryKey: ["master-user-stats"],
    queryFn: async (): Promise<UserStats> => {
      const { data, error } = await supabase
        .from("team_members")
        .select("role, is_active, organization_id");

      if (error) throw error;

      const members = data || [];
      return {
        total: members.length,
        active: members.filter((m) => m.is_active).length,
        admins: members.filter((m) => m.role === "admin").length,
        sdrs: members.filter((m) => m.role === "sdr").length,
        closers: members.filter((m) => m.role === "closer").length,
        withoutOrg: members.filter((m) => !m.organization_id).length,
      };
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Atualizar usuário/membro
 */
export function useMasterUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teamMemberId,
      updates,
    }: {
      teamMemberId: string;
      updates: {
        name?: string;
        role?: string;
        is_active?: boolean;
        organization_id?: string;
      };
    }) => {
      const { data, error } = await supabase
        .from("team_members")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", teamMemberId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-users"] });
      queryClient.invalidateQueries({ queryKey: ["master-user-stats"] });
      toast.success("Usuário atualizado!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao atualizar usuário");
    },
  });
}

/**
 * Alterar role de um usuário
 */
export function useMasterChangeUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      newRole,
    }: {
      userId: string;
      newRole: "admin" | "sdr" | "closer";
    }) => {
      // Atualizar na tabela user_roles
      const { error: deleteError } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId);

      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: newRole });

      if (insertError) throw insertError;

      // Atualizar também em team_members
      const { error: updateError } = await supabase
        .from("team_members")
        .update({ role: newRole })
        .eq("user_id", userId);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-users"] });
      queryClient.invalidateQueries({ queryKey: ["master-user-stats"] });
      toast.success("Role alterada com sucesso!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao alterar role");
    },
  });
}

/**
 * Mover usuário para outra organização
 */
export function useMasterMoveUserToOrg() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teamMemberId,
      newOrgId,
    }: {
      teamMemberId: string;
      newOrgId: string;
    }) => {
      const { error } = await supabase
        .from("team_members")
        .update({ organization_id: newOrgId })
        .eq("id", teamMemberId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-users"] });
      queryClient.invalidateQueries({ queryKey: ["master-organization-members"] });
      toast.success("Usuário movido para nova organização!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao mover usuário");
    },
  });
}

/**
 * Desativar/Ativar usuário
 */
export function useMasterToggleUserActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teamMemberId,
      isActive,
    }: {
      teamMemberId: string;
      isActive: boolean;
    }) => {
      const { error } = await supabase
        .from("team_members")
        .update({ is_active: isActive })
        .eq("id", teamMemberId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["master-users"] });
      toast.success(variables.isActive ? "Usuário ativado!" : "Usuário desativado!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao alterar status do usuário");
    },
  });
}

/** Usuário que se cadastrou mas não tem organização (não está em team_members) */
export interface UnassignedUser {
  id: string;
  email: string;
  created_at: string;
  full_name: string | null;
}

/**
 * Lista usuários que se cadastraram por si só mas não têm organização (Master only)
 */
export function useMasterUnassignedUsers() {
  return useQuery({
    queryKey: ["master-unassigned-users"],
    queryFn: async (): Promise<UnassignedUser[]> => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Não autenticado");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
      if (!supabaseUrl?.trim() || !anonKey?.trim()) throw new Error("Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env");
      const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/list-unassigned-users`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${anonKey}`,
          "X-User-JWT": token,
        },
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; users?: UnassignedUser[]; error?: string; message?: string };
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? "Erro ao listar cadastros pendentes");
      if (!data.success || !Array.isArray(data.users)) return [];
      return data.users;
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Vincula um usuário (cadastro pendente) a uma organização (Master only)
 */
export function useMasterAssignUserToOrg() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      user_id,
      organization_id,
      role,
      email,
      full_name,
    }: {
      user_id: string;
      organization_id: string;
      role?: string;
      email?: string;
      full_name?: string | null;
    }) => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Não autenticado");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
      if (!supabaseUrl?.trim() || !anonKey?.trim()) throw new Error("Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env");
      const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/assign-user-to-org`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
          "X-User-JWT": token,
        },
        body: JSON.stringify({
          user_id,
          organization_id,
          role: role ?? "member",
          email: email ?? undefined,
          full_name: full_name ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? "Erro ao vincular usuário");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-unassigned-users"] });
      queryClient.invalidateQueries({ queryKey: ["master-users"] });
      queryClient.invalidateQueries({ queryKey: ["master-user-stats"] });
      toast.success("Usuário vinculado à organização!");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao vincular usuário");
    },
  });
}

/**
 * Redefinir senha de um usuário (Master only)
 * Chama a Edge Function admin-reset-user-password.
 */
export function useMasterResetUserPassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      user_id,
      new_password,
    }: {
      user_id: string;
      new_password: string;
    }) => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Não autenticado");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
      if (!supabaseUrl?.trim() || !anonKey?.trim())
        throw new Error("Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env");

      const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/admin-reset-user-password`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
          "X-User-JWT": token,
        },
        body: JSON.stringify({ user_id, new_password: new_password.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? "Erro ao redefinir senha");
      return data;
    },
    onSuccess: () => {
      toast.success("Senha alterada com sucesso!");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao redefinir senha");
    },
  });
}
