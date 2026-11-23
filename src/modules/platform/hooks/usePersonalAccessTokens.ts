import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { notifyError } from "@/shared/errors";

/**
 * Tokens pessoais do crm-mcp (ADR 0012, DESIGN §7.5).
 *
 * - Listar e revogar rodam direto sob a RLS de quem está logado: o membro vê e revoga os
 *   próprios; o admin da org vê e revoga os da org inteira (governança).
 * - Criar passa pela edge fn `create-pat`: ela gera o token, grava só o hash e devolve o
 *   texto UMA vez.
 *
 * `personal_access_tokens` ainda não está no tipo gerado do banco; o cliente sem tipo
 * evita `any` espalhado e as linhas são tipadas aqui.
 */
const db = supabase as unknown as SupabaseClient;

export interface PersonalAccessToken {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  /** Nome de quem criou (para o admin, que vê os da equipe). */
  owner_name: string | null;
}

export interface CreatedPersonalAccessToken {
  id: string;
  name: string;
  token_prefix: string;
  expires_at: string;
  created_at: string;
  /** Texto do token — só existe nesta resposta. */
  token: string;
}

const QUERY_KEY = "personal-access-tokens";

export function usePersonalAccessTokens() {
  const { organizationId } = useOrganization();

  return useQuery<PersonalAccessToken[]>({
    queryKey: [QUERY_KEY, organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const [tokens, members] = await Promise.all([
        db
          .from("personal_access_tokens")
          .select("id, user_id, name, token_prefix, last_used_at, expires_at, revoked_at, revoked_reason, created_at")
          .eq("organization_id", organizationId!)
          .order("created_at", { ascending: false })
          .limit(200),
        db.from("team_members").select("user_id, name").eq("organization_id", organizationId!),
      ]);
      if (tokens.error) throw tokens.error;
      const nomes = new Map<string, string>(
        ((members.data ?? []) as Array<{ user_id: string | null; name: string | null }>)
          .filter((m) => m.user_id && m.name)
          .map((m) => [m.user_id as string, m.name as string]),
      );
      return ((tokens.data ?? []) as Omit<PersonalAccessToken, "owner_name">[]).map((t) => ({
        ...t,
        owner_name: nomes.get(t.user_id) ?? null,
      }));
    },
  });
}

export function useCreatePersonalAccessToken() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation<CreatedPersonalAccessToken, Error, { name: string; expires_in_days: number }>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke("create-pat", {
        body: { ...input, organization_id: organizationId },
      });
      // O corpo da recusa (403/409) traz a frase em PT; notifyError a desembrulha.
      if (error) throw error;
      return data as CreatedPersonalAccessToken;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
    onError: (e) => {
      notifyError(e, { fallback: "Não foi possível criar o token." });
    },
  });
}

export function useRevokePersonalAccessToken() {
  const queryClient = useQueryClient();

  return useMutation<string, Error, { id: string; suspeitaDeVazamento?: boolean }>({
    mutationFn: async ({ id, suspeitaDeVazamento }) => {
      // O motivo final é carimbado pelo banco conforme quem revoga (dono, admin, master);
      // só "compromise" é escolha de quem clica.
      const { data, error } = await db
        .from("personal_access_tokens")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: suspeitaDeVazamento ? "compromise" : "user" })
        .eq("id", id)
        .is("revoked_at", null)
        .select("id");
      if (error) throw error;
      // UPDATE sem linha volta 200: sem isto, revogar o token de um colega sem permissão
      // pareceria ter dado certo.
      if (!data || data.length === 0) throw new Error("Token não encontrado ou já revogado.");
      return id;
    },
    onSuccess: () => {
      toast.success("Token revogado. A IA conectada com ele para na próxima chamada.");
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
    onError: (e) => {
      notifyError(e, { fallback: "Não foi possível revogar o token." });
    },
  });
}
