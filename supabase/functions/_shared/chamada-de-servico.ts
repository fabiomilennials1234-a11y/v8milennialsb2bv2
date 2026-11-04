/**
 * Chamada de serviço entre edge functions (ex.: lista-fria-importar-e-disparar →
 * blast-plan-create).
 *
 * Quem chama JÁ validou o acesso do usuário à organização e fala em nome dele:
 * o bearer é a própria service role e a org e o autor vêm no corpo. Qualquer
 * outro bearer NÃO é chamada de serviço, e `organization_id`/`acting_user_id` do
 * corpo são ignorados: a org de um usuário nunca vem do payload.
 */
import { timingSafeCompare } from "./auth.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChamadaDeServico =
  | { servico: false }
  | { servico: true; ok: true; orgId: string; actorUserId: string }
  | { servico: true; ok: false; erro: string };

export function lerChamadaDeServico(bearer: string, serviceRoleKey: string, body: unknown): ChamadaDeServico {
  // Chave vazia nunca casa: sem service role configurada, ninguém é "serviço".
  if (serviceRoleKey.length === 0 || bearer.length === 0 || !timingSafeCompare(bearer, serviceRoleKey)) {
    return { servico: false };
  }
  const corpo = (body ?? {}) as Record<string, unknown>;
  const orgId = corpo.organization_id;
  const actorUserId = corpo.acting_user_id;
  if (typeof orgId !== "string" || !UUID.test(orgId) || typeof actorUserId !== "string" || !UUID.test(actorUserId)) {
    return { servico: true, ok: false, erro: "Chamada de serviço exige organization_id e acting_user_id" };
  }
  return { servico: true, ok: true, orgId, actorUserId };
}
