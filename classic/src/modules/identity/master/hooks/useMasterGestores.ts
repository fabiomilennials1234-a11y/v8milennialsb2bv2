/**
 * Hooks para o Master gerenciar Gestores de Portfólio (ADR-0021 §8).
 *
 * Gestor de Portfólio = "scoped master": ator fora de `team_members` com escrita
 * full de admin operacional nas orgs vinculadas pelo Master. Esta camada é a UI
 * do Master para criar/desativar gestores e vincular/desvincular organizações.
 *
 * Padrão de acesso às tabelas: `gestores` / `gestor_organizations` existem em PROD
 * (S1 #1137) mas estão AUSENTES de `src/integrations/supabase/types.ts` (drift
 * repo↔prod — regenerar o types.ts inteiro traria mudanças não relacionadas). Por
 * isso consultamos via `.from("<tabela>" as any)` + cast local (mesmo padrão de
 * `useGestor`).
 *
 * Leitura/desativação: query/mutation direta sob RLS master-only (tabelas já vivas
 * em PROD). Criação de gestor (precisa criar/reusar auth user = service_role) e
 * binding de orgs roteiam por edge functions master-gated (`create-gestor`,
 * `manage-gestor-orgs`) — mesmo padrão de `useMasterUnassignedUsers`/
 * `useMasterAssignUserToOrg`.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { GestorRow, GestorOrganizationRow } from "../../gestor";
import { toast } from "sonner";

/** Linha de gestor enriquecida para a tabela do Master. */
export interface MasterGestorView extends GestorRow {
  /** Nome do perfil (profiles.full_name), quando existir. */
  full_name: string | null;
  /** Ids das orgs atualmente vinculadas a este gestor. */
  organization_ids: string[];
}

const GESTORES_KEY = ["master-gestores"] as const;

function edgeUrl(fn: string): { url: string; anonKey: string } {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!supabaseUrl?.trim() || !anonKey?.trim()) {
    throw new Error("Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env");
  }
  return { url: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${fn}`, anonKey };
}

async function callEdge<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const token = session?.session?.access_token;
  if (!token) throw new Error("Não autenticado");

  const { url, anonKey } = edgeUrl(fn);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
      "X-User-JWT": token,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; error?: string } & T;
  if (!res.ok || data?.success === false) {
    throw new Error(data?.message ?? data?.error ?? `Erro ao chamar ${fn}`);
  }
  return data as T;
}

/**
 * Lista TODOS os gestores (sem filtro de org) com nome do perfil e orgs vinculadas.
 */
export function useMasterGestores() {
  return useQuery({
    queryKey: GESTORES_KEY,
    queryFn: async (): Promise<MasterGestorView[]> => {
      // `gestores` ausente do types gerado (drift repo↔prod) → cast (ver header).
      const { data: gestoresRaw, error: gErr } = await supabase
        .from("gestores" as any)
        .select("id, user_id, is_active, notes, created_at")
        .order("created_at", { ascending: false });
      if (gErr) throw gErr;
      const gestores = (gestoresRaw ?? []) as unknown as GestorRow[];
      if (gestores.length === 0) return [];

      const { data: bindingsRaw, error: bErr } = await supabase
        .from("gestor_organizations" as any)
        .select("id, gestor_id, organization_id, created_at");
      if (bErr) throw bErr;
      const bindings = (bindingsRaw ?? []) as unknown as GestorOrganizationRow[];

      // Nome do perfil (profiles é público). Email vive em auth.users e não é
      // acessível daqui — exibe full_name + user_id (follow-up: edge fn de perfil).
      const userIds = gestores.map((g) => g.user_id);
      const { data: profilesRaw } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      const profileName = new Map(
        (profilesRaw ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? null]),
      );

      const bindingsByGestor = new Map<string, string[]>();
      for (const b of bindings) {
        const arr = bindingsByGestor.get(b.gestor_id) ?? [];
        arr.push(b.organization_id);
        bindingsByGestor.set(b.gestor_id, arr);
      }

      return gestores.map((g) => ({
        ...g,
        full_name: profileName.get(g.user_id) ?? null,
        organization_ids: bindingsByGestor.get(g.id) ?? [],
      }));
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Cria um gestor (seleciona auth user existente por email OU cria) e opcionalmente
 * já vincula orgs. Roteia pela edge fn `create-gestor` (service_role, master-gated).
 */
export function useCreateGestor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      email: string;
      name?: string;
      password?: string;
      notes?: string;
      organization_ids?: string[];
    }) => {
      return callEdge<{ gestor_id: string; user_id: string }>("create-gestor", {
        email: input.email.trim().toLowerCase(),
        name: input.name?.trim() || undefined,
        password: input.password?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        organization_ids: input.organization_ids ?? [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GESTORES_KEY });
      toast.success("Gestor criado com sucesso!");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao criar gestor");
    },
  });
}

/**
 * Ativa/desativa um gestor. Update direto sob RLS master-only (tabela viva em PROD).
 * Desativar revoga o acesso imediatamente (os helpers de RLS recomputam por chamada).
 */
export function useToggleGestorActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ gestorId, isActive }: { gestorId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("gestores" as any)
        .update({ is_active: isActive })
        .eq("id", gestorId);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: GESTORES_KEY });
      toast.success(variables.isActive ? "Gestor ativado!" : "Gestor desativado!");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao alterar status do gestor");
    },
  });
}

/**
 * Define o conjunto completo de orgs vinculadas a um gestor (reconcilia server-side:
 * vincula as novas, desvincula as removidas). Roteia pela edge fn `manage-gestor-orgs`
 * (service_role, master-gated). Idempotente.
 */
export function useSetGestorOrgs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ gestorId, organizationIds }: { gestorId: string; organizationIds: string[] }) => {
      return callEdge<{ bound: string[] }>("manage-gestor-orgs", {
        gestor_id: gestorId,
        organization_ids: organizationIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GESTORES_KEY });
      toast.success("Organizações vinculadas atualizadas!");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao atualizar organizações do gestor");
    },
  });
}
