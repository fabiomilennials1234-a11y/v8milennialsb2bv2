import { supabase } from "@/integrations/supabase/client";

/** Ausência da lista mantém o comportamento das organizações não configuradas. */
export function chatLeadCreationAllowed(flags: Record<string, unknown>, userId: string | null): boolean {
  if (!("chat_lead_creation_user_ids" in flags)) return true;
  const users = flags.chat_lead_creation_user_ids;
  return !!userId && Array.isArray(users) && users.includes(userId);
}

export async function readChatLeadCreationAllowed(organizationId: string): Promise<boolean> {
  const [{ data, error }, auth] = await Promise.all([
    supabase.from("organizations").select("feature_flags").eq("id", organizationId).single(),
    supabase.auth.getUser(),
  ]);
  if (error) throw error;
  if (auth.error) throw auth.error;
  if (!auth.data.user) return false;
  const flags = data.feature_flags ?? {};
  if (typeof flags !== "object" || Array.isArray(flags)) return false;
  return chatLeadCreationAllowed(flags as Record<string, unknown>, auth.data.user.id);
}

/** Releitura no envio: não confia na permissão que ficou em cache na tela. */
export async function assertChatLeadCreationAllowed(organizationId: string): Promise<void> {
  if (!await readChatLeadCreationAllowed(organizationId)) {
    throw new Error("Você não tem permissão para criar leads pelo chat nesta organização.");
  }
}
