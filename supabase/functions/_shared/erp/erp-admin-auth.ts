/**
 * Resolve a organização do usuário do JWT e exige papel de administrador.
 *
 * Conectar, desconectar e sondar um ERP são ações de administrador: expõem
 * credencial da empresa e disparam tráfego para um sistema externo. As funções
 * do Omie carregam uma cópia desta lógica cada uma; a do Toth usa esta — o
 * alinhamento do Omie é refactor preguiçoso, conforme ADR-0020 §Consequências
 * ("extrair a costura, construir o novo limpo, alinhar o antigo depois").
 *
 * ⚠️ O org_id NUNCA vem do corpo da requisição: vem do vínculo em `team_members`
 * do usuário autenticado. É o invariante multi-tenant do produto.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

export type AdminOrgResult =
  | { ok: true; organizationId: string; userId: string }
  | { ok: false; error: string };

export async function resolveAdminOrg(
  admin: SupabaseClient,
  authHeader: string | null,
  action: string,
): Promise<AdminOrgResult> {
  if (!authHeader) return { ok: false, error: "Não autorizado" };

  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error,
  } = await asUser.auth.getUser();
  if (error || !user) return { ok: false, error: "Usuário não autenticado" };

  const { data: member } = await admin
    .from("team_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member?.organization_id) {
    return { ok: false, error: "Usuário não vinculado a uma organização" };
  }
  if (!["admin", "master"].includes(member.role)) {
    return { ok: false, error: `Apenas administradores podem ${action}` };
  }
  return { ok: true, organizationId: member.organization_id as string, userId: user.id };
}
